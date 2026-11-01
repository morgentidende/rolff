// POST {email}                                  -> new conversation + e-mail invitation (invitee mail + copy to inviter)
// POST {action:"member", conversation_id, email, role} -> extra participant (writer/reader); asks all other members to approve
// POST {action:"consent"|"decline", invitation_id}
// When the last member approves, a one-time link is minted and mailed to the participant. No message content in any mail.
import { authed, cors, json } from "../_shared/http.ts";
import { approvalMail, copyMail, inviteMail, memberInviteMail, sendMail } from "../_shared/email.ts";

const errCode = (m: string) => /rate_limited/.test(m) ? "rate_limited" : /bad_email|bad_role/.test(m) ? "bad_input" : /forbidden/.test(m) ? "forbidden" : /stale/.test(m) ? "stale" : /not_found/.test(m) ? "not_found" : "invite_failed";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const base = Deno.env.get("APP_URL") ?? "";
  const action = String(i?.action ?? "conversation");

  const notifyApprovers = async (inv: string, role: string) => {
    const r = await a.admin.rpc("pending_approver_emails", { inv });
    let n = 0; for (const row of (r.data ?? []) as { email: string }[]) if (row.email && await sendMail(row.email, approvalMail({ role, appUrl: base }))) n++;
    return n;
  };
  const mailParticipant = async (d: { token: string; invitee_email: string; inviter_email: string }, role: string) => {
    const exp = new Date(Date.now() + 72 * 3600e3).toISOString();
    return sendMail(d.invitee_email, memberInviteMail({ inviterEmail: d.inviter_email, link: `${base}#invite=${d.token}`, expires: exp, role }));
  };

  if (action === "member") {
    const role = i?.role === "writer" ? "writer" : i?.role === "reader" ? "reader" : "";
    const r = await a.user.rpc("create_member_invitation", { conv: String(i?.conversation_id ?? ""), p_email: String(i?.email ?? ""), p_role: role || "parent" });
    if (r.error) return json({ error: errCode(r.error.message) }, 400);
    const d = r.data[0];
    if (d.complete) {
      const ok = await mailParticipant(d, role);
      if (!ok) await a.user.rpc("revoke_invitation", { inv: d.invitation_id });
      return json({ data: { status: ok ? "sent" : "failed" } }, ok ? 200 : 502);
    }
    const notified = await notifyApprovers(d.invitation_id, role);
    return json({ data: { status: "pending", notified } });
  }
  if (action === "consent" || action === "decline") {
    const inv = String(i?.invitation_id ?? "");
    if (action === "decline") {
      const r = await a.user.rpc("decline_invitation", { inv });
      return r.error ? json({ error: errCode(r.error.message) }, 400) : json({ data: { status: "declined" } });
    }
    const r = await a.user.rpc("consent_member_invitation", { inv });
    if (r.error) return json({ error: errCode(r.error.message) }, 400);
    const d = r.data[0];
    if (!d?.complete) return json({ data: { status: "pending" } });
    const roleRow = await a.admin.from("invitations").select("role").eq("id", inv).single();
    const ok = await mailParticipant(d, roleRow.data?.role ?? "reader");
    return json({ data: { status: ok ? "sent" : "mail_failed" } }, ok ? 200 : 502);
  }

  const r = await a.user.rpc("create_email_invitation", { p_email: String(i?.email ?? "") });
  if (r.error) return json({ error: errCode(r.error.message) }, 400);
  const d = r.data[0];
  const link = `${base}#invite=${d.token}`;
  const email = String(i.email).trim().toLowerCase();
  const sentInvitee = await sendMail(email, inviteMail({ inviterEmail: d.inviter_email, link, expires: d.expires_at }));
  const sentCopy = sentInvitee ? await sendMail(d.inviter_email, copyMail({ inviteeEmail: email, expires: d.expires_at })) : false;
  if (!sentInvitee) await a.user.rpc("revoke_invitation", { inv: d.invitation_id });
  return json({ data: { conversation_id: d.conversation_id, sent: sentInvitee, copy_sent: sentCopy } }, sentInvitee ? 200 : 502);
});
