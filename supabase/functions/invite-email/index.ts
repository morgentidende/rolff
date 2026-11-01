// POST {name, email} -> creates a new conversation + e-mail-bound invitation, mails the invitee and a copy (without link) to the inviter.
import { authed, cors, json } from "../_shared/http.ts";
import { copyMail, inviteMail, sendMail } from "../_shared/email.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const r = await a.user.rpc("create_email_invitation", { p_name: String(i?.name ?? ""), p_email: String(i?.email ?? "") });
  if (r.error) {
    const m = r.error.message;
    return json({ error: /rate_limited/.test(m) ? "rate_limited" : /bad_email|bad_name/.test(m) ? "bad_input" : "invite_failed" }, 400);
  }
  const d = r.data[0];
  const base = Deno.env.get("APP_URL") ?? "";
  const link = `${base}#invite=${d.token}`;
  const name = String(i.name).trim(), email = String(i.email).trim().toLowerCase();
  const sentInvitee = await sendMail(email, inviteMail({ inviter: d.inviter_name, invitee: name, link, expires: d.expires_at }));
  const sentCopy = sentInvitee ? await sendMail(d.inviter_email, copyMail({ inviter: d.inviter_name, invitee: name, inviteeEmail: email, expires: d.expires_at })) : false;
  if (!sentInvitee) await a.user.rpc("revoke_invitation", { inv: d.invitation_id });
  return json({ data: { conversation_id: d.conversation_id, sent: sentInvitee, copy_sent: sentCopy } }, sentInvitee ? 200 : 502);
});
