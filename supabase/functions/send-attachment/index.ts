import { checkTopics, validateFilterSnapshot } from "../_shared/topics.ts";
// POST {conversation_id, idempotency_key, file_b64, file_name, caption?, alt?}
// Same pipeline as send-message, for one image/PDF: auth (sender must have plan 'text_attachments')
// -> membership/role/rate (prepare_send) -> plan -> file checks (magic bytes, size, pages, no animation)
// -> rules on caption -> AI (OpenAI Responses, store:false) on file+caption -> blocked words / prefilter
// on the transcript -> approval bound to sender+conversation+sha256(body+sha256(file)) -> atomic store.
// Nothing is stored or delivered before moderation passes. Fail closed. No content in logs.
import { authed, cors, json } from "../_shared/http.ts";
import { normalizeReplyId } from "../_shared/replies.ts";
import { replyModerationContext } from "../_shared/replyContext.ts";
import { planLengthError } from "../_shared/planLimits.ts";
import { checkPersonLimits } from "../_shared/limits.ts";
import { checkRules, findBlockedWord } from "../_shared/rules.ts";
import { charCount, ModerationTechnicalError, prefilter, resolveSenderLang, timeoutFromEnv, UNCERTAIN_EXPLANATION } from "../_shared/moderation.ts";
import { attachmentKind, blockedAttachmentStatus, checkFile, cleanName, filePromptForLang, MAX_BYTES, openaiFileModerate, parseAttachmentBlocks, validateFileResult } from "../_shared/attachments.ts";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (d: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", (typeof d === "string" ? new TextEncoder().encode(d) : d) as BufferSource));
const isProd = () => (Deno.env.get("APP_ENV") ?? "test") === "production";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const a = await authed(req); if (a instanceof Response) return a;
  const { uid, admin } = a;
  let input: any; try { input = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const conv = String(input?.conversation_id ?? "").toLowerCase(); const key = String(input?.idempotency_key ?? "");
  const caption = String(input?.caption ?? "").trim(); const alt = [...String(input?.alt ?? "").trim()].slice(0, 300).join("");
  const name = cleanName(String(input?.file_name ?? ""));
  if (!/^[0-9a-f-]{36}$/i.test(conv) || !/^[\w-]{8,80}$/.test(key)) return json({ error: "bad_request" }, 400);
  if (charCount(caption) > 480) return json({ error: "length", limit: 480, count: charCount(caption) }, 400);
  const b64s = String(input?.file_b64 ?? "");
  if (b64s.length > Math.ceil(MAX_BYTES / 3) * 4 + 8) return json({ error: "too_large" }, 413);
  let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(b64s), (c) => c.charCodeAt(0)); } catch { return json({ error: "bad_request" }, 400); }

  const body = caption || `Vedhæftning: ${name}`;
  const reply = normalizeReplyId(input?.reply_to_id);
  if (reply !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reply)) return json({ error: "invalid_reply" }, 400);

  const prev = await admin.from("messages").select("id,conversation_id,body,body_hash").eq("sender_id", uid).eq("idempotency_key", key).maybeSingle();
  if (prev.error) return json({ status: "technical_error" }, 503);
  if (prev.data) {
    const oldReply = await admin.from("message_replies").select("target_fingerprint").eq("message_id", prev.data.id).maybeSingle();
    if (oldReply.error) return json({ status: "technical_error" }, 503);
    const oldFile = await admin.from("message_attachments").select("name,alt").eq("message_id", prev.data.id).maybeSingle();
    if (oldFile.error) return json({ status: "technical_error" }, 503);
    if (!oldFile.data || oldFile.data.name !== name || (oldFile.data.alt ?? "") !== alt || prev.data.body_hash !== await sha(body + "\n" + await sha(bytes))) return json({ error: "idempotency_conflict" }, 409);
    if (prev.data.conversation_id !== conv || (oldReply.data?.target_fingerprint ?? null) !== (reply ? await sha(reply) : null)) return json({ error: "idempotency_conflict" }, 409);
    return json({ status: "accepted", message_id: prev.data.id, duplicate: true });
  }


  const target = await admin.rpc("assert_reply_target", { p_sender: uid, conv, p_reply: reply });
  if (target.error) return json({ error: "invalid_reply" }, 400);

  // Person limits (frequency, then length) before rate limit and AI.
  const pl = await checkPersonLimits(admin, conv, uid, charCount(caption));
  if (pl === "error") return json({ status: "technical_error" }, 503);
  if (pl) return json(pl, 200);
  const prep = await admin.rpc("prepare_send", { p_sender: uid, conv, p_body: body });
  if (prep.error) {
    const m = prep.error.message;
    const limit = planLengthError(m, charCount(caption)); if (limit) return json(limit, 200);
    const code = /read_only/.test(m) ? "read_only" : /rate_limited/.test(m) ? "rate_limited" : /length/.test(m) ? "length" : "forbidden";
    return json({ error: code }, code === "rate_limited" ? 429 : 403);
  }
  // Plan after role check, so readers get read_only.
  const plan = await admin.rpc("_effective_plan", { uid });
  if (plan.error) return json({ status: "technical_error" }, 503);
  if (plan.data !== "text_attachments") return json({ error: "plan_required", plan: plan.data }, 402);
  const fc = checkFile(bytes);
  if (!fc.ok) return json({ error: fc.error }, fc.error === "too_large" ? 413 : 415);

  const ctx = (prep.data ?? []).map((r: any) => ({ mine: r.ctx_mine, body: r.ctx_body }));
  // Replies: Luna always sees the replied-to message as context (server-fetched, visibility re-checked).
  const modCtx = await replyModerationContext(admin, uid, conv, reply, ctx);
  if (modCtx === "invalid_reply") return json({ error: "invalid_reply" }, 400);
  if (modCtx === "error") return json({ status: "technical_error" }, 503);
  const blk = await admin.from("conversation_blocks").select("user_id").eq("conversation_id", conv).neq("user_id", uid).limit(1);
  if (blk.error) return json({ status: "technical_error" }, 503);
  if ((blk.data ?? []).length) return json({ status: "cannot_deliver" }, 200);
  const flags = await admin.rpc("recipient_attachment_blocks", { conv, p_sender: uid });
  if (flags.error) return json({ status: "technical_error" }, 503);
  let typeBlock;
  try {
    const kind = attachmentKind(fc.mime);
    if (!kind) return json({ error: "bad_type" }, 415);
    typeBlock = blockedAttachmentStatus(kind, parseAttachmentBlocks(flags.data));
  } catch { return json({ status: "technical_error" }, 503); }
  if (typeBlock) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: typeBlock });
    return json({ status: typeBlock }, 200);
  }
  const snapshot = await admin.rpc("recipient_filter_snapshot", { conv, p_sender: uid });
  let policy;
  try { if (snapshot.error) throw new Error(); policy = validateFilterSnapshot(snapshot.data); }
  catch { return json({ status: "technical_error" }, 503); }
  const words = policy.words;
  if (caption) {
    const hit = checkRules(caption, words, ctx.filter((c: any) => c.mine).map((c: any) => c.body));
    if (hit) {
      await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: "rule" });
      return json(hit.rule === "blocked_word" ? { status: "blocked_word", word: hit.word, where: "caption" } : { status: "rule", rule: hit.rule }, 200);
    }
  }

  // Files need a provider that accepts images/PDF: OpenAI only. Anything else fails closed.
  const lang = await resolveSenderLang(input?.lang, async () => (await admin.rpc("locale_of", { p_uid: uid })).data);
  const apiKey = Deno.env.get("OPENAI_API_KEY"); const base = Deno.env.get("OPENAI_BASE_URL") ?? "https://eu.api.openai.com/v1";
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";
  if (Deno.env.get("MODERATION_PROVIDER") !== "openai" || !apiKey || !/^https:\/\/([a-z0-9-]+\.)*openai\.com\/v1\/?$/.test(base)) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "error", p_reason: "config" });
    return json({ status: "technical_error", detail: "unavailable" }, 503);
  }
  const t0 = Date.now(); const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), Math.max(timeoutFromEnv({ get: (k) => Deno.env.get(k) }), 30000));
  let res, usage;
  try {
    const out = await openaiFileModerate({ apiKey, model, baseUrl: base, prompt: filePromptForLang(lang) }, { mime: fc.mime, bytes, name }, caption, modCtx, ac.signal);
    usage = out.usage; res = validateFileResult(out.raw, caption);
  } catch (e) {
    const kind = e instanceof ModerationTechnicalError ? e.message : ac.signal.aborted ? "timeout" : "provider_error";
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "error", p_reason: kind });
    console.log(JSON.stringify({ evt: "file_moderation_error", kind }));
    return json({ status: "technical_error" }, 503);
  } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  const meta = isProd() ? undefined : { ms, input_tokens: usage.input, output_tokens: usage.output, model };
  console.log(JSON.stringify({ evt: "file_moderation", kind: fc.mime, pages: fc.pages, ms, in_tok: usage.input, out_tok: usage.output, decision: res.decision }));

  if (res.decision === "block") {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: res.reason_code });
    const explanation = res.reason_code === "uncertain" ? UNCERTAIN_EXPLANATION[lang] : res.explanation;
    return json({ status: "blocked", reason_code: res.reason_code, spans: res.spans, suggestion: res.suggestion, ...(explanation ? { explanation } : {}), meta }, 200);
  }
  // Same blocked words and hard prefilter as normal messages, on the text found in the file.
  const w = findBlockedWord(res.transcript + "\n" + name, words);
  if (w) { await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: "rule" }); return json({ status: "blocked_word", word: w, where: "file", meta }, 200); }
  const pre = prefilter(res.transcript) ?? prefilter(res.transcript + "\n" + name);
  if (pre) { await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: pre.reason_code }); return json({ status: "blocked", reason_code: pre.reason_code, spans: pre.spans, suggestion: pre.suggestion, meta }, 200); }
  if (res.decision === "clarify") {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "clarify", p_reason: "unclear_meaning" });
    return json({ status: "clarification_required", meta }, 200);
  }

  const hash = await sha(body + "\n" + await sha(bytes));
  // This stage can only deny or request clarification AFTER global safety allows.
  try {
    const decision = await checkTopics({ get: k => Deno.env.get(k) }, [caption, res.transcript, name, alt].join("\n"), policy.topics, modCtx, timeoutFromEnv({ get: k => Deno.env.get(k) }));
    if (decision !== "allow") {
      await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: decision, p_reason: "private_boundary" });
      return json({ status: decision === "block" ? "private_boundary" : "clarification_required" }, 200);
    }
  } catch { return json({ status: "technical_error" }, 503); }

  await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "allow", p_reason: "none" });
  const appr = await admin.rpc("issue_reply_approval_v3", { p_revision: policy.revision, p_sender: uid, conv, p_hash: hash, p_reply: reply, p_provider: "openai", p_model: model });
  if (appr.error) return json({ status: "technical_error" }, 503);
  const c = await admin.rpc("commit_attachment_reply", { p_approval: appr.data, p_sender: uid, conv, p_body: body, p_key: key, p_reply: reply,
    p_mime: fc.mime, p_name: name, p_alt: alt, p_pages: fc.pages, p_data: "\\x" + hex(bytes.buffer as ArrayBuffer) });
  if (c.error) { const limit = planLengthError(c.error.message, charCount(caption)); if (limit) return json(limit, 200); }
  if (c.error && /invalid_reply/.test(c.error.message)) return json({ error: "invalid_reply" }, 400);
  if (c.error && /idempotency_conflict/.test(c.error.message)) return json({ error: "idempotency_conflict" }, 409);
  if (c.error && /cannot_deliver/.test(c.error.message)) return json({ status: "cannot_deliver" }, 200);
  if (c.error && /blocked_photos/.test(c.error.message)) { await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: "blocked_photos" }); return json({ status: "blocked_photos" }, 200); }
  if (c.error && /blocked_files/.test(c.error.message)) { await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: "blocked_files" }); return json({ status: "blocked_files" }, 200); }
  if (c.error && /person_frequency/.test(c.error.message)) { const again = await checkPersonLimits(admin, conv, uid, 0); return json(again && again !== "error" ? again : { status: "frequency_limit" }, 200); }
  if (c.error && /plan_required/.test(c.error.message)) return json({ error: "plan_required" }, 402);
  if (c.error && /rate_limited/.test(c.error.message)) return json({ error: "rate_limited" }, 429);
  if (c.error || !c.data?.[0]) return json({ status: "technical_error" }, 503);
  return json({ status: "accepted", message_id: c.data[0].message_id, duplicate: c.data[0].duplicate, meta });
});
