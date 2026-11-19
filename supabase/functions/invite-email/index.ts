// All POSTs may carry lang:"da"|"en" (the caller's app language; default "da").
// POST {email}                                  -> new conversation + e-mail invitation (invitee mail + copy to inviter)
// POST {action:"member", conversation_id, email, role} -> extra participant (writer/reader); asks all other members to approve
// POST {action:"consent"|"decline", invitation_id}
// POST {action:"resend", invitation_id}         -> mint a fresh link and mail it again (rate-limited in SQL)
// POST {action:"link", invitation_id}           -> mint a fresh link and return it so the inviter can share it
// When the last member approves, a one-time link is minted and mailed to the participant. No message content in any mail.
// A failed mail never leaves the invitation stuck: it stays pending, is flagged mail_failed, and can be resent or copied.
import { authed, cors, json } from "../_shared/http.ts";
import { approvalMail, copyMail, inviteMail, mailLang, memberInviteMail, sendMail, sendMailResult } from "../_shared/email.ts";
import { appUrl, inviteLink } from "../_shared/links.ts";

const errCode = (m: string) => /plan_required/.test(m) ? "plan_required" : /rate_limited/.test(m) ? "rate_limited" : /bad_email|bad_role/.test(m) ? "bad_input" : /forbidden/.test(m) ? "forbidden" : /stale/.test(m) ? "stale" : /not_ready/.test(m) ? "not_ready" : /not_found/.test(m) ? "not_found" : "invite_failed";
const errStatus = (code: string) => code === "plan_required" ? 402 : code === "rate_limited" ? 429 : 400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const a = await authed(req); if (a instanceof Response) return a;
  let i: any; try { i = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const base = appUrl();
  const action = String(i?.action ?? "conversation");
  // The calling user's app language ("da" | "en"; anything else -> "da"). Invitation mails follow it.
  const lang = mailLang(i?.lang);

  const markMail = async (inv: string, ok: boolean) => { try { await a.admin.rpc("set_invitation_mail_status", { inv, ok }); } catch { /* best effort */ } };
  const notifyApprovers = async (inv: string, role: string) => {
    const r = await a.admin.rpc("pending_approver_emails", { inv });
    let n = 0; for (const row of (r.data ?? []) as { email: string }[]) if (row.email && await sendMail(row.email, approvalMail({ role, appUrl: base, lang }), "approval")) n++;
    return n;
  };
  const mailParticipant = async (d: { invitation_id?: string; token: string; invitee_email: string; inviter_email: string }, role: string, expires?: string) => {
    const exp = expires ?? new Date(Date.now() + 72 * 3600e3).toISOString();
    const r = await sendMailResult(d.invitee_email, memberInviteMail({ inviterEmail: d.inviter_email, link: inviteLink(d.token), expires: exp, role, inviteeEmail: d.invitee_email, lang }), "member_invite");
    if (d.invitation_id) await markMail(d.invitation_id, r.ok);
    return r;
  };

  if (action === "member") {
    const role = i?.role === "writer" ? "writer" : i?.role === "reader" ? "reader" : "";
    const r = await a.user.rpc("create_member_invitation", { conv: String(i?.conversation_id ?? ""), p_email: String(i?.email ?? ""), p_role: role || "parent" });
    if (r.error) { const code = errCode(r.error.message); return json({ error: code }, errStatus(code)); }
    const d = r.data[0];
    if (d.complete) {
      const m = await mailParticipant(d, role);
      return json({ data: { status: m.ok ? "sent" : "mail_failed", invitation_id: d.invitation_id, reason: m.ok ? undefined : m.reason } }, m.ok ? 200 : 502);
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
    const m = await mailParticipant({ ...d, invitation_id: inv }, roleRow.data?.role ?? "reader");
    return json({ data: { status: m.ok ? "sent" : "mail_failed", invitation_id: inv, reason: m.ok ? undefined : m.reason } }, m.ok ? 200 : 502);
  }
  if (action === "resend" || action === "link") {
    const inv = String(i?.invitation_id ?? "");
    const r = await a.user.rpc("reissue_invitation_link", { inv });
    if (r.error) { const code = errCode(r.error.message); return json({ error: code }, errStatus(code)); }
    const d = r.data?.[0];
    if (!d?.token) return json({ error: "not_found" }, 400);
    const link = inviteLink(d.token);
    if (action === "link") return json({ data: { status: "link", link, expires_at: d.expires_at } });
    const msg = d.role === "parent"
      ? inviteMail({ inviterEmail: d.inviter_email, link, expires: d.expires_at, inviteeEmail: d.invitee_email, lang })
      : memberInviteMail({ inviterEmail: d.inviter_email, link, expires: d.expires_at, role: d.role, inviteeEmail: d.invitee_email, lang });
    const m = await sendMailResult(d.invitee_email, msg, "resend");
    await markMail(inv, m.ok);
    return json({ data: { status: m.ok ? "sent" : "mail_failed", reason: m.ok ? undefined : m.reason } }, m.ok ? 200 : 502);
  }

  const r = await a.user.rpc("create_email_invitation", { p_email: String(i?.email ?? "") });
  if (r.error) { const code = errCode(r.error.message); return json({ error: code }, errStatus(code)); }
  const d = r.data[0];
  const link = inviteLink(d.token);
  const email = String(i.email).trim().toLowerCase();
  const sent = await sendMailResult(email, inviteMail({ inviterEmail: (await a.admin.rpc("public_label_of", { uid: a.uid })).data ?? d.inviter_email, link, expires: d.expires_at, inviteeEmail: email, lang }), "invite");
  await markMail(d.invitation_id, sent.ok);
  const sentCopy = sent.ok ? await sendMail(d.inviter_email, copyMail({ inviteeEmail: email, expires: d.expires_at, lang }), "invite_copy") : false;
  // On failure the conversation and invitation stay so "Send igen" / "Kopiér invitationslink" work from the chat.
  return json({ data: { conversation_id: d.conversation_id, invitation_id: d.invitation_id, sent: sent.ok, copy_sent: sentCopy, reason: sent.ok ? undefined : sent.reason } }, sent.ok ? 200 : 502);
});
