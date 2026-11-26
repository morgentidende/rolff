// POST {conversation_id, category: harassment|inappropriate|child_safety|other, body ≤2000, message_ids ≤20}
// Logged-in only, explicit user action. Saves metadata, then mails the chosen content to REPORT_EMAIL_TO
// (fallback: FEEDBACK_TO). A failed mail is logged without content; the report stays saved.
// Stored: only metadata in report_log (rate limit 3/24h). Logs never contain report or message text.
import { authed, cors, json } from "../_shared/http.ts";
import { reportMail, reportRecipient, sendMail } from "../_shared/email.ts";
import { parseReport, REPORT_CATS } from "../_shared/reportInput.ts";
export { REPORT_CATS };

type Row = { report_id?: string; id?: string | null; sender_id?: string | null; body?: string | null; created_at?: string | null };

async function emailsById(admin: { auth: { admin: { getUserById: (id: string) => Promise<{ data: { user?: { email?: string } | null } }> } } }, ids: string[]) {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  await Promise.all(uniq.map(async (id) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const email = data.user?.email ?? "";
      if (email) out.set(id, email);
    } catch { /* leave missing; never log the address */ }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const p = parseReport(i); if (!p) return json({ error: "bad_input" }, 400);
  const { conv, category, body, ids } = p;
  const r = await a.user.rpc("submit_report", { conv, p_category: category, p_message_ids: ids });
  if (r.error) {
    const m = r.error.message;
    return json({ error: /rate_limited/.test(m) ? "rate_limited" : /not_member/.test(m) ? "forbidden" : "bad_input" }, /rate_limited/.test(m) ? 429 : 400);
  }
  const rows = (r.data ?? []) as Row[];
  const reportId = String(rows[0]?.report_id ?? "");
  const msgs = rows.filter((row) => row.id);
  let mailed = false;
  try {
    const to = reportRecipient();
    if (to) {
      const want = [a.uid, ...msgs.map((m) => m.sender_id).filter((x): x is string => !!x)];
      const emails = await emailsById(a.admin, want);
      mailed = await sendMail(to, reportMail({
        category,
        body,
        reportId,
        reporterId: a.uid,
        reporterEmail: emails.get(a.uid) ?? "",
        conversationId: conv,
        messages: msgs.map((m) => ({
          sender_id: m.sender_id ?? "",
          sender_email: emails.get(m.sender_id ?? "") ?? "",
          body: m.body ?? "",
          created_at: m.created_at ?? "",
        })),
      }), "report");
    }
  } catch { /* fail quietly */ }
  if (!mailed) console.log(JSON.stringify({ evt: "report_mail_failed" }));
  return json({ data: { saved: true, mailed } });
});
