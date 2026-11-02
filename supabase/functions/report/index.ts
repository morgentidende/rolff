// POST {conversation_id, category: harassment|inappropriate|child_safety|other, body ≤2000, message_ids ≤20}
// Logged-in only, explicit user action. Sends a mail to FEEDBACK_TO with exactly what the user chose.
// Stored: only metadata in report_log (rate limit). Logs never contain report or message text.
import { authed, cors, json } from "../_shared/http.ts";
import { reportMail, sendMail } from "../_shared/email.ts";
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const UUID = /^[0-9a-f-]{36}$/i;
export const REPORT_CATS = ["harassment", "inappropriate", "child_safety", "other"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const conv = String(i?.conversation_id ?? "");
  const category = REPORT_CATS.includes(i?.category) ? i.category : null;
  const body = String(i?.body ?? "").trim();
  const ids = Array.isArray(i?.message_ids) ? i.message_ids.map(String) : [];
  if (!UUID.test(conv) || !category || [...body].length > 2000 || ids.length > 20 || !ids.every((x: string) => UUID.test(x))) return json({ error: "bad_input" }, 400);
  if (!body && ids.length === 0) return json({ error: "bad_input" }, 400);
  const r = await a.user.rpc("submit_report", { conv, p_category: category, p_message_ids: ids });
  if (r.error) {
    const m = r.error.message;
    return json({ error: /rate_limited/.test(m) ? "rate_limited" : /not_member/.test(m) ? "forbidden" : "bad_input" }, /rate_limited/.test(m) ? 429 : 400);
  }
  const to = Deno.env.get("FEEDBACK_TO") ?? "";
  const { data: prof } = await a.admin.from("profiles").select("display_name").eq("user_id", a.uid).maybeSingle();
  let mailed = false;
  if (EMAIL.test(to)) mailed = await sendMail(to, reportMail({ category, body, senderName: prof?.display_name ?? "–", senderId: a.uid, conversationId: conv, messages: (r.data ?? []) as any[] }));
  if (!mailed) console.log(JSON.stringify({ evt: "report_mail_failed" })); // no content in logs
  return json({ data: { sent: mailed } }, mailed ? 200 : 502);
});
