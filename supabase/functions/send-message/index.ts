import { checkTopics, validateFilterSnapshot } from "../_shared/topics.ts";
// POST {conversation_id, body, idempotency_key}
// Server-enforced pipeline: auth -> membership/role/length/rate (prepare_send) -> prefilter -> LLM ->
// strict validation -> single-use approval bound to sender+conversation+sha256(body) (60s) ->
// atomic consume + store (commit_message, idempotent). Fail closed on any error.
// A text blocked once (sender+conversation, normalized hash) stays blocked: sticky blocks beat model nondeterminism.
import { authed, cors, json } from "../_shared/http.ts";
import { normalizeReplyId } from "../_shared/replies.ts";
import { replyModerationContext } from "../_shared/replyContext.ts";
import { checkPlanLength, planLengthError } from "../_shared/planLimits.ts";
import { checkPersonLimits } from "../_shared/limits.ts";
import { HOUSE_EXPLANATION } from "../_shared/houseRules.ts";
import { checkRules } from "../_shared/rules.ts";
import { applySticky, shouldRememberBlock, stickyHash } from "../_shared/stickyBlock.ts";
import { charCount, doubleCheckFromEnv, moderate, moderationContract, ModerationTechnicalError, providerFromEnv, resolveSenderLang, timeoutFromEnv, UNCERTAIN_EXPLANATION } from "../_shared/moderation.ts";

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const a = await authed(req); if (a instanceof Response) return a;
  const { uid, admin } = a;
  let input: any; try { input = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const conv = String(input?.conversation_id ?? "").toLowerCase(); let body = String(input?.body ?? ""); const key = String(input?.idempotency_key ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(conv) || !/^[\w-]{8,80}$/.test(key)) return json({ error: "bad_request" }, 400);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawEdit = input?.edit_message_id;
  const editId0 = rawEdit == null || rawEdit === "" ? null : String(rawEdit).toLowerCase();
  if (editId0 !== null && !UUID.test(editId0)) return json({ error: "bad_request" }, 400);
  // Resume a held (paused) delayed message: the STORED text goes through the full pipeline again against the
  // current recipient lists (house rules, blocked words, topics, model). Only an approval ends the hold.
  const rawResume = input?.resume_message_id;
  const resumeId = rawResume == null || rawResume === "" ? null : String(rawResume).toLowerCase();
  if (resumeId !== null && (!UUID.test(resumeId) || editId0 !== null)) return json({ error: "bad_request" }, 400);
  // From here on editId means "targets an existing held message" (edit or resume).
  const editId = editId0 ?? resumeId;
  let heldBody: string | null = null;
  if (resumeId !== null) {
    const held = await admin.rpc("get_resumable_message", { p_sender: uid, p_id: resumeId });
    if (held.error && /no_longer_pending|not_found/.test(held.error.message)) return json({ error: "no_longer_pending" }, 409);
    if (held.error || !held.data?.[0]) return json({ status: "technical_error" }, 503);
    if (held.data[0].conversation_id !== conv) return json({ error: "bad_request" }, 400);
    body = heldBody = String(held.data[0].body);
  }
  if (body.trim().length === 0) return json({ error: "length" }, 400);

  const reply = editId ? null : normalizeReplyId(input?.reply_to_id);
  if (reply !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reply)) return json({ error: "invalid_reply" }, 400);

  // Idempotent retry: if already stored, return the same result without re-moderating.
  if (!editId) {
  const prev = await admin.from("messages").select("id,conversation_id,body").eq("sender_id", uid).eq("idempotency_key", key).maybeSingle();
  if (prev.error) return json({ status: "technical_error" }, 503);
  if (prev.data) {
    const oldReply = await admin.from("message_replies").select("target_fingerprint").eq("message_id", prev.data.id).maybeSingle();
    if (oldReply.error) return json({ status: "technical_error" }, 503);
    const oldFile = await admin.from("message_attachments").select("message_id").eq("message_id", prev.data.id).maybeSingle();
    if (oldFile.error) return json({ status: "technical_error" }, 503);
    if (oldFile.data) return json({ error: "idempotency_conflict" }, 409);
    if (prev.data.conversation_id !== conv || (oldReply.data?.target_fingerprint ?? null) !== (reply ? await sha256Hex(reply) : null) || prev.data.body !== body) return json({ error: "idempotency_conflict" }, 409);
    return json({ status: "accepted", message_id: prev.data.id, duplicate: true });
  }
  }

  const quota = await checkPlanLength(admin, uid, charCount(body));
  if (quota === "error") return json({ status: "technical_error" }, 503);
  if (quota) return json(quota, 200);

  if (!editId) {
  const target = await admin.rpc("assert_reply_target", { p_sender: uid, conv, p_reply: reply });
  if (target.error) return json({ error: "invalid_reply" }, 400);
  }

  // Person limits (frequency, then length) before rate limit and AI.
  // An edit of a held message is not a new send, so frequency is not re-applied.
  if (!editId) {
  const pl = await checkPersonLimits(admin, conv, uid, charCount(body));
  if (pl === "error") return json({ status: "technical_error" }, 503);
  if (pl) return json(pl, 200);
  }
  const prep = await admin.rpc("prepare_send", { p_sender: uid, conv, p_body: body });
  if (prep.error) {
    const m = prep.error.message;
    const limit = planLengthError(m, charCount(body)); if (limit) return json(limit, 200);
    const code = /read_only/.test(m) ? "read_only" : /rate_limited/.test(m) ? "rate_limited" : /length/.test(m) ? "length" : "forbidden";
    return json({ error: code }, code === "rate_limited" ? 429 : 403);
  }
  let ctx = (prep.data ?? []).map((r: any) => ({ mine: r.ctx_mine, body: r.ctx_body }));
  // Resuming: the held message itself is part of the recent history, it is not a "repeat" of itself and not context.
  if (heldBody !== null) { const at = ctx.map((c: any, i: number) => (c.mine && c.body === heldBody ? i : -1)).filter((i: number) => i >= 0).pop(); if (at !== undefined) ctx = ctx.filter((_: any, i: number) => i !== at); }
  // Replies: Luna always sees the replied-to message as context (server-fetched, visibility re-checked).
  const modCtx = await replyModerationContext(admin, uid, conv, reply, ctx);
  if (modCtx === "invalid_reply") return json({ error: "invalid_reply" }, 400);
  if (modCtx === "error") return json({ status: "technical_error" }, 503);

  // Conversation blocked by another member (also enforced by DB trigger). Says nothing about who/when.
  const blk = await admin.from("conversation_blocks").select("user_id").eq("conversation_id", conv).neq("user_id", uid).limit(1);
  if (blk.error) return json({ status: "technical_error" }, 503);
  if ((blk.data ?? []).length) return json({ status: "cannot_deliver" }, 200);
  // Rule pre-checks: recipients' private blocked words (only the matched word is returned, never the list), emoji, text emoticons, caps, repeat.
  const snapshot = await admin.rpc("recipient_filter_snapshot", { conv, p_sender: uid });
  let policy;
  try { if (snapshot.error) throw new Error(); policy = validateFilterSnapshot(snapshot.data); }
  catch { return json({ status: "technical_error" }, 503); }
  const hit = checkRules(body, policy.words, ctx.filter((c: any) => c.mine).map((c: any) => c.body));
  if (hit) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: "rule" });
    const rule = hit.rule === "emoticon" ? "emoji" : hit.rule;
    return json(hit.rule === "blocked_word" ? { status: "blocked_word", word: hit.word } : { status: "rule", rule, ...(hit.word ? { word: hit.word } : {}) }, 200);
  }

  const lang = await resolveSenderLang(input?.lang, async () => (await admin.rpc("locale_of", { p_uid: uid })).data);
  let provider;
  try { provider = providerFromEnv({ get: (k) => Deno.env.get(k) }, moderationContract(lang)); }
  catch (e) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "error", p_reason: "config" });
    return json({ status: "technical_error", detail: (e as Error).message === "free_tier_forbidden_in_production" ? "config" : "unavailable" }, 503);
  }
  // Sticky block lookup (fail closed): a text blocked before stays blocked, whatever the model says now.
  const textKey = await stickyHash(body);
  const remembered = await admin.rpc("recent_moderation_block", { p_sender: uid, conv, p_hash: textKey });
  if (remembered.error) return json({ status: "technical_error" }, 503);
  let res;
  try { res = await moderate(provider, body, modCtx, timeoutFromEnv({ get: (k) => Deno.env.get(k) }), { doubleCheck: doubleCheckFromEnv({ get: (k) => Deno.env.get(k) }), bannedWords: policy.words }); }
  catch (e) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "error", p_reason: e instanceof ModerationTechnicalError ? e.message : "unknown" });
    // No message text in logs.
    console.log(JSON.stringify({ evt: "moderation_error", kind: e instanceof ModerationTechnicalError ? e.message : "unknown" }));
    return json({ status: "technical_error" }, 503);
  }
  res = applySticky(res, remembered.data);
  if (shouldRememberBlock(res)) {
    const mem = await admin.rpc("remember_moderation_block", { p_sender: uid, conv, p_hash: textKey, p_reason: res.reason_code });
    if (mem.error) console.log(JSON.stringify({ evt: "sticky_block_store_error" }));
    if ("sticky" in res) console.log(JSON.stringify({ evt: "sticky_block_applied" }));
  }
  if (res.decision !== "allow") await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: res.decision, p_reason: "sticky" in res ? "sticky_" + res.reason_code : res.reason_code });
  // "uncertain" (borderline tone): always the same short, friendly Rolff text in the sender's language.
  const explanation = res.decision === "block" && "house" in res && res.house ? HOUSE_EXPLANATION[res.house][lang] : res.decision === "block" && res.reason_code === "uncertain" ? (res.explanation || UNCERTAIN_EXPLANATION[lang]) : res.explanation;
  if (res.decision === "block") return json({ status: "blocked", reason_code: res.reason_code, spans: res.spans, suggestion: res.suggestion, ...(explanation ? { explanation } : {}), ...("house" in res && res.house ? { house: res.house } : {}) }, 200);
  if (res.decision === "clarify") return json({ status: "clarification_required" }, 200);

  // This stage can only deny or request clarification AFTER global safety allows.
  try {
    const decision = await checkTopics({ get: k => Deno.env.get(k) }, body, policy.topics, modCtx, timeoutFromEnv({ get: k => Deno.env.get(k) }));
    if (decision !== "allow") {
      await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: decision, p_reason: "private_boundary" });
      return json({ status: decision === "block" ? "private_boundary" : "clarification_required" }, 200);
    }
  } catch { return json({ status: "technical_error" }, 503); }

  await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "allow", p_reason: "none" });
  const appr = await admin.rpc("issue_reply_approval_v3", { p_revision: policy.revision, p_sender: uid, conv, p_hash: await sha256Hex(body), p_reply: reply, p_provider: provider.name, p_model: provider.model });
  if (appr.error) return json({ status: "technical_error" }, 503);
  const c = resumeId
    ? await admin.rpc("resume_held_message", { p_approval: appr.data, p_sender: uid, p_id: resumeId })
    : editId
    ? await admin.rpc("update_delayed_message", { p_approval: appr.data, p_sender: uid, p_id: editId, p_body: body })
    : await admin.rpc("commit_message_reply", { p_approval: appr.data, p_sender: uid, conv, p_body: body, p_key: key, p_reply: reply });
  if (c.error) { const limit = planLengthError(c.error.message, charCount(body)); if (limit) return json(limit, 200); }
  if (c.error && /no_longer_pending/.test(c.error.message)) return json({ error: "no_longer_pending" }, 409);
  if (c.error && /invalid_reply/.test(c.error.message)) return json({ error: "invalid_reply" }, 400);
  if (c.error && /idempotency_conflict/.test(c.error.message)) return json({ error: "idempotency_conflict" }, 409);
  if (c.error && /cannot_deliver/.test(c.error.message)) return json({ status: "cannot_deliver" }, 200);
  if (c.error && /person_frequency/.test(c.error.message)) { const again = await checkPersonLimits(admin, conv, uid, 0); return json(again && again !== "error" ? again : { status: "frequency_limit" }, 200); }
  if (c.error || !c.data?.[0]) return json({ status: "technical_error" }, 503);
  // Generic acceptance only: says nothing about recipient delivery/reading/windows.
  return json({ status: "accepted", message_id: c.data[0].message_id, duplicate: editId ? false : c.data[0].duplicate });
});
