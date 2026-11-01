// Invitation e-mail templates. Never include message content.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (d: string) => new Date(d).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const logoUrl = () => `${(Deno.env.get("APP_URL") ?? "").replace(/\/?$/, "/")}icons/rolff-128.png`;
function shell(title: string, inner: string) {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2f2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
<tr><td bgcolor="#016C72" style="background:#016C72;padding:20px 28px;color:#ffffff">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="48" style="width:48px;padding-right:14px;vertical-align:middle"><img src="${logoUrl()}" width="48" height="48" alt="Rolff logo" style="display:block;width:48px;height:48px;border:0;border-radius:11px;background:#016C72;color:#ffffff;font-size:12px"></td>
<td style="vertical-align:middle;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.3px">Rolff<div style="font-size:13px;font-weight:400;opacity:.85;margin-top:2px">Rolig kommunikation mellem forældre</div></td>
</tr></table></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#7a807e;border-top:1px solid #eeeae3">Rolff er en testversion. Skriv kun opdigtede beskeder – AI-kontrollen kører på en gratis testtjeneste.</td></tr>
</table></td></tr></table></body></html>`;
}

export function inviteMail(p: { inviter: string; invitee: string; link: string; expires: string }) {
  const subject = `${p.inviter} inviterer dig til Rolff`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej ${esc(p.invitee)},</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviter)}</strong> har inviteret dig til en fælles samtale i Rolff – en rolig chat, hvor beskeder bliver tjekket for tonen, før de sendes.</p>
<p style="margin:0 0 22px">Tryk på knappen for at vælge en adgangskode og komme ind i samtalen.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#016C72" style="border-radius:10px;background:#016C72"><a href="${esc(p.link)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">Åbn invitationen</a></td></tr></table>
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Linket virker én gang og udløber ${esc(fmt(p.expires))}. Kun denne e-mailadresse kan bruge det. Kender du ikke afsenderen, kan du bare slette mailen.</p>`);
  const text = `Hej ${p.invitee},\n\n${p.inviter} har inviteret dig til en fælles samtale i Rolff.\n\nÅbn invitationen: ${p.link}\n\nLinket virker én gang og udløber ${fmt(p.expires)}. Kun denne e-mailadresse kan bruge det.\n\nRolff (testversion) – skriv kun opdigtede beskeder.`;
  return { subject, html, text };
}

export function copyMail(p: { inviter: string; invitee: string; inviteeEmail: string; expires: string }) {
  const subject = `Kopi: Din invitation til ${p.invitee} er sendt`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej ${esc(p.inviter)},</p>
<p style="margin:0 0 14px">Din invitation til <strong>${esc(p.invitee)}</strong> (${esc(p.inviteeEmail)}) er sendt. Når invitationen er taget imod, finder I samtalen i Rolff.</p>
<p style="margin:0;font-size:13px;color:#7a807e">Af sikkerhedshensyn er linket kun med i modtagerens mail. Invitationen udløber ${esc(fmt(p.expires))}.</p>`);
  const text = `Hej ${p.inviter},\n\nDin invitation til ${p.invitee} (${p.inviteeEmail}) er sendt. Linket er kun med i modtagerens mail. Udløber ${fmt(p.expires)}.\n\nRolff (testversion)`;
  return { subject, html, text };
}

export async function sendMail(to: string, m: { subject: string; html: string; text: string }): Promise<boolean> {
  const url = Deno.env.get("MAILER_URL"), secret = Deno.env.get("MAILER_SECRET");
  if (!url || !secret) return false;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-rolff-secret": secret }, body: JSON.stringify({ to, ...m }), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch { return false; }
}
