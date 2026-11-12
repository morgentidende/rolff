// POST {category: suggestion|complaint, body ≤2000 chars (also a DB check)} (logged-in only, explicit click) -> saves feedback (rate limited in SQL) and mails it to FEEDBACK_TO (server-side env).
// Logs never contain the feedback text.
import { authed, cors, json } from "../_shared/http.ts";
import { feedbackMail, sendMail } from "../_shared/email.ts";
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const category = ["suggestion", "complaint"].includes(i?.category) ? i.category : null;
  if (!category) return json({ error: "bad_input" }, 400);
  const body = String(i?.body ?? "").trim();
  if (!body || [...body].length > 2000) return json({ error: "bad_input" }, 400);
  const r = await a.user.rpc("submit_feedback", { p_category: category, p_body: body });
  if (r.error) return json({ error: /rate_limited/.test(r.error.message) ? "rate_limited" : "save_failed" }, /rate_limited/.test(r.error.message) ? 429 : 400);
  const to = Deno.env.get("FEEDBACK_TO") ?? "";
  let mailed = false;
  if (EMAIL.test(to)) mailed = await sendMail(to, feedbackMail({ category, body, senderName: "–", senderId: a.uid }));
  if (!mailed) console.log("feedback saved; mail not sent"); // no content in logs
  return json({ data: { saved: true, mailed } });
});
