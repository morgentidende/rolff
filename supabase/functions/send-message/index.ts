// POST {conversation_id, body, idempotency_key}
// Server-enforced pipeline: auth -> membership/role/length/rate (prepare_send) -> prefilter -> LLM ->
// strict validation -> single-use approval bound to sender+conversation+sha256(body) (60s) ->
// atomic consume + store (commit_message, idempotent). Fail closed on any error.
import { authed, cors, json } from "../_shared/http.ts";
import { checkRules } from "../_shared/rules.ts";
import { charCount, MAX_CHARS, moderate, ModerationTechnicalError, providerFromEnv, timeoutFromEnv } from "../_shared/moderation.ts";

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
  const conv = String(input?.conversation_id ?? ""); const body = String(input?.body ?? ""); const key = String(input?.idempotency_key ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(conv) || !/^[\w-]{8,80}$/.test(key)) return json({ error: "bad_request" }, 400);
  if (body.trim().length === 0 || charCount(body) > MAX_CHARS) return json({ error: "length" }, 400);

  // Idempotent retry: if already stored, return the same result without re-moderating.
  const prev = await admin.from("messages").select("id").eq("sender_id", uid).eq("idempotency_key", key).maybeSingle();
  if (prev.data) return json({ status: "accepted", message_id: prev.data.id, duplicate: true });

  const prep = await admin.rpc("prepare_send", { p_sender: uid, conv, p_body: body });
  if (prep.error) {
    const m = prep.error.message;
    const code = /read_only/.test(m) ? "read_only" : /rate_limited/.test(m) ? "rate_limited" : /length/.test(m) ? "length" : "forbidden";
    return json({ error: code }, code === "rate_limited" ? 429 : 403);
  }
  const ctx = (prep.data ?? []).map((r: any) => ({ mine: r.ctx_mine, body: r.ctx_body }));

  // Conversation blocked by another member (also enforced by DB trigger). Says nothing about who/when.
  const blk = await admin.from("conversation_blocks").select("user_id").eq("conversation_id", conv).neq("user_id", uid).limit(1);
  if (blk.error) return json({ status: "technical_error" }, 503);
  if ((blk.data ?? []).length) return json({ status: "cannot_deliver" }, 200);
  // Rule pre-checks: recipients' private blocked words (only the matched word is returned, never the list), emoji, caps, repeat.
  const bw = await admin.rpc("recipient_blocked_words", { conv, p_sender: uid });
  if (bw.error) return json({ status: "technical_error" }, 503);
  const hit = checkRules(body, (bw.data ?? []) as string[], ctx.filter((c: any) => c.mine).map((c: any) => c.body));
  if (hit) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "block", p_reason: "rule" });
    return json(hit.rule === "blocked_word" ? { status: "blocked_word", word: hit.word } : { status: "rule", rule: hit.rule }, 200);
  }

  let provider;
  try { provider = providerFromEnv({ get: (k) => Deno.env.get(k) }); }
  catch (e) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "error", p_reason: "config" });
    return json({ status: "technical_error", detail: (e as Error).message === "free_tier_forbidden_in_production" ? "config" : "unavailable" }, 503);
  }
  let res;
  try { res = await moderate(provider, body, ctx, timeoutFromEnv({ get: (k) => Deno.env.get(k) })); }
  catch (e) {
    await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: "error", p_reason: e instanceof ModerationTechnicalError ? e.message : "unknown" });
    // No message text in logs.
    console.log(JSON.stringify({ evt: "moderation_error", kind: e instanceof ModerationTechnicalError ? e.message : "unknown" }));
    return json({ status: "technical_error" }, 503);
  }
  await admin.rpc("record_attempt", { p_sender: uid, conv, p_decision: res.decision, p_reason: res.reason_code });
  if (res.decision === "block") return json({ status: "blocked", reason_code: res.reason_code, spans: res.spans }, 200);

  const appr = await admin.rpc("issue_approval", { p_sender: uid, conv, p_hash: await sha256Hex(body), p_provider: provider.name, p_model: provider.model });
  if (appr.error) return json({ status: "technical_error" }, 503);
  const c = await admin.rpc("commit_message", { p_approval: appr.data, p_sender: uid, conv, p_body: body, p_key: key });
  if (c.error && /cannot_deliver/.test(c.error.message)) return json({ status: "cannot_deliver" }, 200);
  if (c.error || !c.data?.[0]) return json({ status: "technical_error" }, 503);
  // Generic acceptance only: says nothing about recipient delivery/reading/windows.
  return json({ status: "accepted", message_id: c.data[0].message_id, duplicate: c.data[0].duplicate });
});
