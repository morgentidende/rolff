// Attachment checks + AI moderation of files. Pure module (no Supabase deps), runs in Deno & tests.
// Never log file content, transcripts or captions.
import { ContextMsg, ModerationTechnicalError, REASON_CODES, SYSTEM_PROMPT, CTX_MAX, CTX_CHARS, sanitizeSuggestion, sanitizeExplanation, DECISIONS, RESPONSE_SCHEMA, validateDecisionContract, type Decision } from "./moderation.ts";

export const MAX_BYTES = 4 * 1024 * 1024, MAX_PAGES = 5;
export type AttMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
/** Type from magic bytes only (the client's claimed type/extension is ignored). */
export function sniff(b: Uint8Array): AttMime | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
/** GIF with more than one frame or a looping extension counts as animated. */
export function gifAnimated(b: Uint8Array): boolean {
  const s = latin1(b);
  if (s.includes("NETSCAPE2.0") || s.includes("ANIMEXTS1.0")) return true;
  return (s.split("\x21\xF9\x04").length - 1) > 1;
}
/** Animated WebP has an ANIM chunk. */
export const webpAnimated = (b: Uint8Array) => latin1(b.subarray(0, 4096)).includes("ANIM");
export function pdfInfo(b: Uint8Array): { pages: number; encrypted: boolean } {
  const s = latin1(b);
  return { pages: (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length, encrypted: /\/Encrypt\b/.test(s) };
}

export type FileCheck = { ok: true; mime: AttMime; pages: number | null } | { ok: false; error: "too_large" | "empty" | "bad_type" | "animated" | "too_many_pages" | "encrypted_pdf" };
export function checkFile(b: Uint8Array): FileCheck {
  if (b.length === 0) return { ok: false, error: "empty" };
  if (b.length > MAX_BYTES) return { ok: false, error: "too_large" };
  const mime = sniff(b); if (!mime) return { ok: false, error: "bad_type" };
  if ((mime === "image/gif" && gifAnimated(b)) || (mime === "image/webp" && webpAnimated(b))) return { ok: false, error: "animated" };
  if (mime === "application/pdf") {
    const p = pdfInfo(b);
    if (p.encrypted) return { ok: false, error: "encrypted_pdf" };
    if (p.pages < 1 || p.pages > MAX_PAGES) return { ok: false, error: "too_many_pages" };
    return { ok: true, mime, pages: p.pages };
  }
  return { ok: true, mime, pages: null };
}
/** Display name: no paths/control chars, max 120. */
export const cleanName = (n: string) => ([...n.replace(/^.*[\\/]/, "").replace(/[\p{C}<>"]/gu, "").trim()].slice(0, 120).join("") || "fil");

export const FILE_REASON_CODES = [...REASON_CODES, "inappropriate_image"] as const;
export type FileReason = typeof FILE_REASON_CODES[number];
export interface FileResult { decision: Decision; reason_code: FileReason; spans: string[]; transcript: string; suggestion: string; explanation: string }

export const FILE_PROMPT = `${SYSTEM_PROMPT}

FILE MODE: The NEW MESSAGE is an attached image (screenshot/photo) or PDF plus an optional caption and file name. Apply exactly the same rules to ALL text visible in the file (every page, every line, including screenshots of other apps such as school portals) and to the caption and file name. A file is blocked if ANY single line is a problem, even if the rest is friendly. Text in ALL CAPS or repeated many times to shout or pressure counts as aggression.
Also BLOCK with reason_code "inappropriate_image" if the image itself (not its text) is inappropriate for a co-parenting/conflict chat: obscene or insulting gestures, nudity or sexual content, gore or violence, degrading or mocking pictures of a person, hateful symbols. Ordinary photos, documents, calendars, receipts and neutral screenshots are allowed. A photo with no visible text is NOT unclear merely because transcript is empty. Apply the base understandability rule to the intended caption/visible message: unfamiliar file names or identifiers alone are not unclear. Recognizable harmful image/text takes priority over clarification.
Add a field "transcript": the visible text of the file copied verbatim (max 4000 characters, "" if none). "spans" must be exact substrings of the transcript or the caption.
When you BLOCK, set "suggestion" as in the base rules: only a short constructive rewrite of a concrete legitimate practical wish from caption/visible text; otherwise "". For inappropriate_image with no usable text wish, set "suggestion" to "".
Set "explanation" as in the base rules (about this file/caption's effect; for inappropriate_image describe the kind of image problem in general terms, never describe body parts or quote text).
Respond ONLY with JSON: {"decision","reason_code" (one of ${FILE_REASON_CODES.join("|")}),"spans","transcript","suggestion","explanation"}.`;

export function buildFilePayload(caption: string, name: string, ctx: ContextMsg[]): string {
  return JSON.stringify({
    context: ctx.slice(-CTX_MAX).map((c) => ({ from: c.mine ? "sender" : "other", text: [...c.body].slice(0, CTX_CHARS).join("") })),
    new_message: { caption, file_name: name, file: "attached below" },
  });
}

export function validateFileResult(raw: unknown, caption: string): FileResult {
  let o: any = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { throw new ModerationTechnicalError("invalid_json"); } }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new ModerationTechnicalError("invalid_shape");
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "decision,reason_code,spans,suggestion,transcript" && keys !== "decision,explanation,reason_code,spans,suggestion,transcript") throw new ModerationTechnicalError("invalid_keys");
  if (!(DECISIONS as readonly string[]).includes(o.decision)) throw new ModerationTechnicalError("invalid_decision");
  if (!(FILE_REASON_CODES as readonly string[]).includes(o.reason_code)) throw new ModerationTechnicalError("invalid_reason");
  if (typeof o.transcript !== "string") throw new ModerationTechnicalError("invalid_transcript");
  if (typeof o.suggestion !== "string") throw new ModerationTechnicalError("invalid_suggestion");
  if (!Array.isArray(o.spans) || o.spans.length > 5 || o.spans.some((s: unknown) => typeof s !== "string")) throw new ModerationTechnicalError("invalid_spans");
  validateDecisionContract(o);
  const transcript = [...o.transcript].slice(0, 4000).join("");
  const spans = (o.spans as string[]).filter((s) => s.length > 0 && (transcript.includes(s) || caption.includes(s)));
  if (o.decision === "allow") return { decision: "allow", reason_code: "none", spans: [], transcript, suggestion: "", explanation: "" };
  if (o.decision === "clarify") return { decision: "clarify", reason_code: "unclear_meaning", spans: [], transcript, suggestion: "", explanation: "" };
  const reason = o.reason_code as FileReason;
  const seed = caption.trim() || transcript.slice(0, 200) || "fil";
  const suggestion = reason === "inappropriate_image"
    ? sanitizeSuggestion(o.suggestion, seed, "other_harmful")
    : sanitizeSuggestion(o.suggestion, seed, reason as any);
  const explanation = sanitizeExplanation(o.explanation, spans, [caption, transcript].join("\n"));
  return { decision: "block", reason_code: reason, spans, transcript, suggestion, explanation };
}

export const FILE_RESPONSE_SCHEMA = {
  ...RESPONSE_SCHEMA, additionalProperties: false,
  properties: {
    ...RESPONSE_SCHEMA.properties,
    reason_code: { type: "string", enum: [...FILE_REASON_CODES] },
    transcript: { type: "string" },
  },
  required: [...RESPONSE_SCHEMA.required, "transcript"],
};

export function b64(b: Uint8Array): string {
  let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** OpenAI Responses API with input_image / input_file, store:false. Returns raw JSON text + token usage. */
export async function openaiFileModerate(o: { apiKey: string; model: string; baseUrl: string }, f: { mime: AttMime; bytes: Uint8Array; name: string },
  caption: string, ctx: ContextMsg[], signal: AbortSignal): Promise<{ raw: string; usage: { input: number; output: number } }> {
  const dataUrl = `data:${f.mime};base64,${b64(f.bytes)}`;
  const part = f.mime === "application/pdf" ? { type: "input_file", filename: "document.pdf", file_data: dataUrl } : { type: "input_image", image_url: dataUrl, detail: "high" };
  const r = await fetch(`${o.baseUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model, store: false, instructions: FILE_PROMPT,
      input: [{ role: "user", content: [{ type: "input_text", text: buildFilePayload(caption, f.name, ctx) }, part] }],
      text: { format: { type: "json_schema", name: "file_moderation", strict: true, schema: FILE_RESPONSE_SCHEMA } },
    }),
  });
  if (!r.ok) throw new ModerationTechnicalError(`http_${r.status}`);
  const j = await r.json();
  const raw = j?.output_text ?? (j?.output ?? []).flatMap((x: any) => x?.content ?? []).filter((c: any) => c?.type === "output_text").map((c: any) => c.text).join("");
  if (!raw) throw new ModerationTechnicalError("empty");
  return { raw, usage: { input: j?.usage?.input_tokens ?? 0, output: j?.usage?.output_tokens ?? 0 } };
}
