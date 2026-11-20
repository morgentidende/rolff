import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ATTACHMENT_DAILY_LIMIT, IMAGE_DETAIL, MAX_BYTES, MAX_PAGES, checkFile, cleanName, openaiFileModerate, sniff, validateFileResult } from "../../supabase/functions/_shared/attachments.ts";
const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
Deno.test("sniff uses magic bytes, not names", () => {
  assertEquals(sniff(enc("\x89PNG\r\n\x1a\n....")), "image/png");
  assertEquals(sniff(enc("\xff\xd8\xff\xe0")), "image/jpeg");
  assertEquals(sniff(enc("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assertEquals(sniff(enc("GIF89a......")), "image/gif");
  assertEquals(sniff(enc("%PDF-1.7")), "application/pdf");
  assertEquals(sniff(enc("just text")), null);
});
Deno.test("checkFile rejects animation, pages, encryption, size", () => {
  assertEquals(checkFile(enc("GIF89a" + "\x21\xF9\x04x" + "\x21\xF9\x04y")), { ok: false, error: "animated" });
  assertEquals(checkFile(enc("GIF89aNETSCAPE2.0")), { ok: false, error: "animated" });
  assertEquals(checkFile(enc("RIFF\0\0\0\0WEBPVP8XANIM")), { ok: false, error: "animated" });
  assertEquals(checkFile(enc("%PDF-1.7 " + "/Type /Page ".repeat(6) + "/Type /Pages")), { ok: false, error: "too_many_pages" });
  assertEquals(checkFile(enc("%PDF-1.7 /Type /Page /Encrypt 1 0 R")), { ok: false, error: "encrypted_pdf" });
  assertEquals(checkFile(enc("%PDF-1.7 /Type /Page /Type /Pages")), { ok: true, mime: "application/pdf", pages: 1 });
  assertEquals(checkFile(new Uint8Array(4 * 1024 * 1024 + 1)), { ok: false, error: "too_large" });
  assertEquals(checkFile(new Uint8Array(0)), { ok: false, error: "empty" });
});
Deno.test("cleanName strips paths and markup", () => assertEquals(cleanName('C:\\x\\<b>"a".png'), "ba.png"));
Deno.test("validateFileResult is strict and fails closed", () => {
  const ok = validateFileResult('{"decision":"block","reason_code":"personal_attack","spans":["klovn","not there"],"transcript":"du er en klovn","suggestion":""}', "");
  assertEquals(ok.spans, ["klovn"]);
  assertEquals(ok.suggestion, "");
  const img = validateFileResult('{"decision":"block","reason_code":"inappropriate_image","spans":[],"transcript":"","suggestion":"Prøv et faktuelt dokument i stedet."}', "");
  assertEquals(img.reason_code, "inappropriate_image");
  assertEquals(img.suggestion, "");
  assertThrows(() => validateFileResult('{"decision":"allow","reason_code":"personal_attack","spans":[],"transcript":"","suggestion":""}', ""));
  assertThrows(() => validateFileResult('{"decision":"allow","reason_code":"none","spans":[],"suggestion":""}', ""));
  assertThrows(() => validateFileResult("not json", ""));
});

import { findBlockedWord } from "../../supabase/functions/_shared/rules.ts";
Deno.test("blocked phrases: multi-word, whole sentences, case/diacritics incl. Æ/Ø/Å", () => {
  assertEquals(findBlockedWord("Du er en DÅRLIG FAR, ærligt.", ["dårlig far"]), "DÅRLIG FAR");
  assertEquals(findBlockedWord("du er en darlig   far", ["Dårlig far"]), "darlig   far");
  assertEquals(findBlockedWord("ØV, Æbler er gode", ["øv æbler"]), "ØV, Æbler");
  assertEquals(findBlockedWord("Det er altid din skyld at Emil er ked af det!", ["det er altid din skyld"]), "Det er altid din skyld");
  assertEquals(findBlockedWord("dårligfar", ["dårlig far"]), null);
  assertEquals(findBlockedWord("far er dårlig", ["dårlig far"]), null);
});

Deno.test("file result: controlling_demand + suggestion", () => {
  const r = validateFileResult({ decision: "block", reason_code: "controlling_demand", spans: ["du skal"], transcript: "du skal skrive under", suggestion: "Kan vi gennemgå aftalen?" }, "");
  if (r.reason_code !== "controlling_demand" || !r.suggestion) throw new Error(JSON.stringify(r));
});

Deno.test("file result: empty when no practical core / meta advice", () => {
  const r = validateFileResult({ decision: "block", reason_code: "personal_attack", spans: ["klovn"], transcript: "du er en klovn", suggestion: "Lad os holde samtalen til det konkrete." }, "");
  assertEquals(r.suggestion, "");
});

import { attachmentKind, blockedAttachmentStatus, parseAttachmentBlocks } from "../../supabase/functions/_shared/attachments.ts";
Deno.test("attachment kind is photos vs PDF files", () => {
  assertEquals(attachmentKind("image/png"), "photos");
  assertEquals(attachmentKind("image/jpeg"), "photos");
  assertEquals(attachmentKind("image/webp"), "photos");
  assertEquals(attachmentKind("image/gif"), "photos");
  assertEquals(attachmentKind("application/pdf"), "files");
  assertEquals(attachmentKind("text/plain"), null);
});
Deno.test("blocked attachment status is type-specific and off by default", () => {
  const off = { block_photos: false, block_files: false };
  assertEquals(blockedAttachmentStatus("photos", off), null);
  assertEquals(blockedAttachmentStatus("files", off), null);
  assertEquals(blockedAttachmentStatus("photos", { block_photos: true, block_files: false }), "blocked_photos");
  assertEquals(blockedAttachmentStatus("files", { block_photos: true, block_files: false }), null);
  assertEquals(blockedAttachmentStatus("files", { block_photos: false, block_files: true }), "blocked_files");
  assertEquals(blockedAttachmentStatus("photos", { block_photos: false, block_files: true }), null);
});
Deno.test("parseAttachmentBlocks fails closed on missing or non-boolean flags", () => {
  assertEquals(parseAttachmentBlocks({ block_photos: true, block_files: false }), { block_photos: true, block_files: false });
  assertEquals(parseAttachmentBlocks('{"block_photos":false,"block_files":true}'), { block_photos: false, block_files: true });
  assertThrows(() => parseAttachmentBlocks(null));
  assertThrows(() => parseAttachmentBlocks({ block_photos: true }));
  assertThrows(() => parseAttachmentBlocks({ block_photos: "true", block_files: false }));
  assertThrows(() => parseAttachmentBlocks([]));
});

Deno.test("daily attachment cap is 5 and matches the database function; size/page caps unchanged", () => {
  assertEquals(ATTACHMENT_DAILY_LIMIT, 5);
  assertEquals([MAX_BYTES, MAX_PAGES], [4 * 1024 * 1024, 5]);
  const sql = Deno.readTextFileSync(new URL("../../supabase/migrations/20261120143000_attachment_daily_limit.sql", import.meta.url));
  assertEquals(/_attachment_daily_limit\(\) returns int language sql immutable as \$\$ select (\d+) \$\$/.exec(sql)?.[1], String(ATTACHMENT_DAILY_LIMIT));
  assertEquals(sql.includes("rate_limited"), false); // the old cap of 20 is gone from the commit function
});
Deno.test("send-attachment checks the daily cap before context lookups and the model call, and always releases its slot", () => {
  const src = Deno.readTextFileSync(new URL("../../supabase/functions/send-attachment/index.ts", import.meta.url));
  const at = (needle: string) => { const i = src.indexOf(needle); if (i < 0) throw new Error("missing " + needle); return i; };
  const early = at('rpc("attachment_daily_used"'), reserve = at('rpc("reserve_attachment_slot"'), model = at("openaiFileModerate(");
  assertEquals(early < at("recipient_filter_snapshot") && early < reserve && reserve < model, true);
  assertEquals(src.includes('error: "daily_attachment_limit"') && src.includes("}, 429)"), true);
  assertEquals(src.includes("finally") && src.includes("slotCtx.release"), true);
});
Deno.test("image moderation keeps detail 'high' (never low/auto); PDFs unaffected; mocked fetch only", async () => {
  assertEquals(IMAGE_DETAIL, "high");
  const real = globalThis.fetch; const bodies: any[] = [];
  globalThis.fetch = ((_u: unknown, o: any) => { bodies.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ output_text: "{}", usage: { input_tokens: 1, output_tokens: 1 } }))); }) as typeof fetch;
  try {
    const o = { apiKey: "fabricated", model: "mock", baseUrl: "https://eu.api.openai.com/v1" };
    await openaiFileModerate(o, { mime: "image/png", bytes: enc("\x89PNG\r\n\x1a\n"), name: "a.png" }, "", [], new AbortController().signal);
    await openaiFileModerate(o, { mime: "application/pdf", bytes: enc("%PDF-1.7"), name: "a.pdf" }, "", [], new AbortController().signal);
  } finally { globalThis.fetch = real; }
  const part = (i: number) => bodies[i].input[0].content[1];
  assertEquals(part(0).type, "input_image"); assertEquals(part(0).detail, "high");
  assertEquals(part(1).type, "input_file");
});
// OpenAI published image rules (platform.openai.com/docs/guides/images-vision): patch-based = 32px patches, fit to
// 2048px max side, cap 2500 patches, x1.2; "low" = fit 512x512. Used here only to document the cost bound.
const patchTokens = (w: number, h: number, maxDim = 2048, budget = 2500, mult = 1.2) => {
  const s = Math.min(1, maxDim / Math.max(w, h)); w *= s; h *= s;
  let p = Math.ceil(w / 32) * Math.ceil(h / 32);
  if (p > budget) { let f = Math.sqrt(1024 * budget / (w * h)); do { p = Math.ceil(Math.floor(w * f) / 32) * Math.ceil(Math.floor(h * f) / 32); f -= 0.001; } while (p > budget); }
  return Math.ceil(p * mult);
};
Deno.test("image token estimate: 'high' is already bounded (<= 3000 tokens per image); 5/day caps a sender", () => {
  assertEquals(patchTokens(1170, 2532), 2304); // iPhone screenshot, detail high
  assertEquals(patchTokens(1170, 2532, 512, 1e9), 154); // detail low: text unreadable, not acceptable
  assertEquals(patchTokens(1170 * 1536 / 2532, 1536), 1325); // optional downscale to 1536px: -42%, not implemented
  assertEquals(patchTokens(4000, 3000) <= 3000, true);
  assertEquals(5 * patchTokens(1170, 2532), 11520); // worst realistic day per sender
});
