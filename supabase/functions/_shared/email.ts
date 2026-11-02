import { appUrl } from "./links.ts";
// Invitation e-mail templates. Never include message content.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (d: string) => new Date(d).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const logoUrl = () => `${appUrl()}icons/rolff-128.png`;
function shell(title: string, inner: string) {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2f2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
<tr><td bgcolor="#016C72" style="background:#016C72;padding:20px 28px;color:#ffffff">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="48" style="width:48px;padding-right:14px;vertical-align:middle"><img src="${logoUrl()}" width="48" height="48" alt="Rolff logo" style="display:block;width:48px;height:48px;border:0;border-radius:11px;background:#016C72;color:#ffffff;font-size:12px"></td>
<td style="vertical-align:middle;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.3px">Rolff<div style="font-size:13px;font-weight:400;opacity:.85;margin-top:2px">Rolig, saglig kommunikation i konflikter</div></td>
</tr></table></td></tr>
<tr><td style="padding:14px 28px;background:#fff4d6;border-bottom:1px solid #f0dfa8;font-size:14px;line-height:1.45;color:#5a4300" role="note"><strong>⚠ Dette er en testversion af Rolff</strong> – brug den ikke til rigtige sager eller følsomme oplysninger.</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#7a807e;border-top:1px solid #eeeae3"><strong>Testversion.</strong> Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift, og data kan blive slettet.<br><em>Test version. Do not enter real or sensitive information. Messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off). No uptime guarantee; data may be deleted.</em></td></tr>
</table></td></tr></table></body></html>`;
}

export function inviteMail(p: { inviterEmail: string; link: string; expires: string; inviteeEmail?: string }) {
  const subject = `${p.inviterEmail} har inviteret dig til Rolff`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviterEmail)}</strong> har inviteret dig til en fælles samtale i Rolff – en rolig chat, hvor beskeder bliver tjekket for tonen, før de sendes.</p>
<p style="margin:0 0 22px">Tryk på knappen for at vælge en adgangskode og komme ind i samtalen.</p>
${inviteBlock(p.link, p.inviteeEmail, p.expires)}`);
  const text = `${TESTWARN}Hej,\n\n${p.inviterEmail} har inviteret dig til en fælles samtale i Rolff.\n\nÅbn invitationen: ${p.link}\n\nInvitationen er sendt til ${p.inviteeEmail ?? ""}. Linket virker én gang og udløber ${fmt(p.expires)} (3 dage). Kun denne e-mailadresse kan bruge det.\n\nRolff (testversion): Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift; data kan blive slettet. / Test version: do not enter real or sensitive information; messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off); no uptime guarantee; data may be deleted.`;
  return { subject, html, text };
}

export function copyMail(p: { inviteeEmail: string; expires: string }) {
  const subject = `Kopi: Din invitation til ${p.inviteeEmail} er sendt`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Din invitation til <strong>${esc(p.inviteeEmail)}</strong> er sendt. Når invitationen er taget imod, finder I samtalen i Rolff.</p>
<p style="margin:0;font-size:13px;color:#7a807e">Af sikkerhedshensyn er linket kun med i modtagerens mail. Invitationen udløber ${esc(fmt(p.expires))}.</p>`);
  const text = `${TESTWARN}Hej,\n\nDin invitation til ${p.inviteeEmail} er sendt. Linket er kun med i modtagerens mail. Udløber ${fmt(p.expires)}.\n\nRolff (testversion): Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift; data kan blive slettet. / Test version: do not enter real or sensitive information; messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off); no uptime guarantee; data may be deleted.`;
  return { subject, html, text };
}


const TESTWARN = "!! Dette er en testversion af Rolff – brug den ikke til rigtige sager eller følsomme oplysninger. !!\n\n";
/** Button + plain text link + who it is for. Used by every invitation mail. */
const inviteBlock = (link: string, invitee: string | undefined, expires: string) => `${button(link, "Åbn invitationen")}
<p style="margin:18px 0 0;font-size:13px;color:#4d5351">Virker knappen ikke? Kopiér dette link ind i din browser:<br><a href="${esc(link)}" style="color:#016C72;word-break:break-all">${esc(link)}</a></p>
<p style="margin:14px 0 0;font-size:13px;color:#4d5351">Invitationen er sendt til <strong>${esc(invitee ?? "")}</strong>. Linket virker <strong>én gang</strong> og udløber <strong>${esc(fmt(expires))}</strong> (3 dage). Kender du ikke afsenderen, kan du bare slette mailen.</p>`;
const roleDa = (r: string) => r === "reader" ? "kun læse" : "læse og skrive";
const button = (link: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#016C72" style="border-radius:10px;background:#016C72"><a href="${esc(link)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">${esc(label)}</a></td></tr></table>`;

/** To existing members: someone asks to add a participant. No names, no message content. */
export function approvalMail(p: { role: string; appUrl: string }) {
  const subject = "Rolff: Godkend eller afvis en ny deltager";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Et medlem af en af dine samtaler i Rolff vil gerne tilføje en ny deltager, som skal kunne <strong>${roleDa(p.role)}</strong>.</p>
<p style="margin:0 0 22px">Den nye deltager får først adgang, når alle i samtalen har godkendt. Ét afslag stopper invitationen. Deltageren ser ingen beskeder fra før, hun eller han kom med.</p>
${button(p.appUrl, "Åbn Rolff for at svare")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Log ind og åbn samtalen for at se, hvem det drejer sig om, og for at godkende eller afvise.</p>`);
  const text = `${TESTWARN}Hej,\n\nEt medlem af en af dine samtaler i Rolff vil gerne tilføje en ny deltager (${roleDa(p.role)}). Deltageren får først adgang, når alle har godkendt. Ét afslag stopper invitationen.\n\nÅbn Rolff for at svare: ${p.appUrl}\n\nRolff (testversion): Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift; data kan blive slettet. / Test version: do not enter real or sensitive information; messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off); no uptime guarantee; data may be deleted.`;
  return { subject, html, text };
}

/** To the extra participant after unanimous approval. */
export function memberInviteMail(p: { inviterEmail: string; link: string; expires: string; role: string; inviteeEmail?: string }) {
  const verb = p.role === "reader" ? "læse med" : "deltage";
  const subject = `${p.inviterEmail} har inviteret dig til at ${verb} i en samtale i Rolff`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviterEmail)}</strong> har inviteret dig til at <strong>${verb}</strong> i en samtale i Rolff (adgang: ${roleDa(p.role)}). Alle i samtalen har godkendt invitationen.</p>
<p style="margin:0 0 22px">Du ser kun beskeder fra efter, du er kommet med.</p>
${inviteBlock(p.link, p.inviteeEmail, p.expires)}`);
  const text = `${TESTWARN}Hej,\n\n${p.inviterEmail} har inviteret dig til at ${verb} i en samtale i Rolff (adgang: ${roleDa(p.role)}).\n\nÅbn invitationen: ${p.link}\n\nInvitationen er sendt til ${p.inviteeEmail ?? ""}. Linket virker én gang og udløber ${fmt(p.expires)} (3 dage). Kun denne e-mailadresse kan bruge det.\n\nRolff (testversion): Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift; data kan blive slettet. / Test version: do not enter real or sensitive information; messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off); no uptime guarantee; data may be deleted.`;
  return { subject, html, text };
}

const CATS: Record<string, string> = { suggestion: "Forslag", complaint: "Klage", filter: "Filter-feedback", idea: "Forslag", problem: "Klage", other: "Andet" };
/** Feedback to the team. Category is whitelisted; text and sender are escaped. Never conversation content. */
export function feedbackMail(p: { category: string; body: string; senderName: string; senderId: string }) {
  const cat = CATS[p.category] ?? "Andet";
  const subject = `Rolff feedback: ${cat}`;
  const html = shell(subject, `<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Kategori</p><p style="margin:0 0 16px"><strong>${esc(cat)}</strong></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Fra (kaldenavn / bruger-id)</p><p style="margin:0 0 16px">${esc(p.senderName)} · <code>${esc(p.senderId)}</code></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Feedback</p><div style="margin:0;padding:14px 16px;background:#f6f4ef;border-radius:10px;white-space:pre-wrap;word-break:break-word">${esc(p.body)}</div>`);
  const text = `Rolff feedback\n\nKategori: ${cat}\nFra: ${p.senderName} (${p.senderId})\n\n${p.body}\n`;
  return { subject, html, text };
}

export async function sendMail(to: string, m: { subject: string; html: string; text: string; reply_to?: string }): Promise<boolean> {
  const url = Deno.env.get("MAILER_URL"), secret = Deno.env.get("MAILER_SECRET");
  if (!url || !secret) return false;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-rolff-secret": secret }, body: JSON.stringify({ to, ...m }), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch { return false; }
}

export function inactivityMail(p: { link: string }) {
  const subject = "Din Rolff-konto slettes snart på grund af inaktivitet";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Du har ikke logget ind i Rolff i et stykke tid. Om 14 dage sletter vi din konto og dine egne data automatisk.</p>
<p style="margin:0 0 22px">Vil du beholde kontoen, skal du bare logge ind. Du kan også slå automatisk sletning fra under ⋮ → Privatliv.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#016C72" style="border-radius:10px;background:#016C72"><a href="${esc(p.link)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">Log ind</a></td></tr></table>
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Det, du har skrevet til andre, bliver hos dem – også efter sletning.</p>`);
  const text = `Hej,\n\nDu har ikke logget ind i Rolff i et stykke tid. Om 14 dage sletter vi din konto og dine egne data automatisk. Log ind for at beholde den: ${p.link}\nDu kan slå automatisk sletning fra under ⋮ → Privatliv.\n\nDet, du har skrevet til andre, bliver hos dem – også efter sletning.`;
  return { subject, html, text };
}

export const REPORT_LABELS: Record<string, string> = { harassment: "Chikane/trusler", inappropriate: "Upassende indhold", child_safety: "Børns sikkerhed", other: "Andet" };
export function reportMail(p: { category: string; body: string; senderName: string; senderId: string; conversationId: string; messages: { sender_name: string; body: string; created_at: string }[] }) {
  const cat = REPORT_LABELS[p.category] ?? "Andet";
  const subject = `Rolff rapport: ${cat}`;
  const msgs = p.messages.map((m) => `<div style="margin:0 0 10px;padding:10px 14px;background:#f6f4ef;border-radius:10px"><div style="font-size:12px;color:#7a807e">${esc(m.sender_name)} · ${esc(String(m.created_at))}</div><div style="white-space:pre-wrap;word-break:break-word">${esc(m.body)}</div></div>`).join("");
  const html = shell(subject, `<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Kategori</p><p style="margin:0 0 16px"><strong>${esc(cat)}</strong></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Fra (kaldenavn / bruger-id) · samtale</p><p style="margin:0 0 16px">${esc(p.senderName)} · <code>${esc(p.senderId)}</code> · <code>${esc(p.conversationId)}</code></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Beskrivelse</p><div style="margin:0 0 16px;padding:14px 16px;background:#f6f4ef;border-radius:10px;white-space:pre-wrap;word-break:break-word">${esc(p.body || "–")}</div>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Vedhæftede beskeder valgt af brugeren (${p.messages.length})</p>${msgs || "<p>–</p>"}`);
  const text = `Rolff rapport\n\nKategori: ${cat}\nFra: ${p.senderName} (${p.senderId})\nSamtale: ${p.conversationId}\n\n${p.body || "–"}\n\nVedhæftede beskeder (${p.messages.length}):\n` + p.messages.map((m) => `[${m.created_at}] ${m.sender_name}: ${m.body}`).join("\n") + "\n";
  return { subject, html, text };
}

const btn = (link: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#016C72" style="border-radius:10px;background:#016C72"><a href="${esc(link)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">${esc(label)}</a></td></tr></table>`;
export function recoveryMail(p: { link: string }) {
  const subject = "Nulstil din adgangskode til Rolff";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 22px">Nogen (forhåbentlig dig) har bedt om at nulstille adgangskoden til din Rolff-konto. Tryk på knappen for at vælge en ny. Linket virker én gang og udløber efter kort tid.</p>
${btn(p.link, "Vælg ny adgangskode")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Har du ikke bedt om det, kan du se bort fra denne mail. Din adgangskode ændres ikke.</p>`);
  const text = `Hej,\n\nNogen (forhåbentlig dig) har bedt om at nulstille adgangskoden til din Rolff-konto. Vælg en ny her (virker én gang, udløber efter kort tid):\n${p.link}\n\nHar du ikke bedt om det, kan du se bort fra denne mail.`;
  return { subject, html, text };
}
export function emailChangeMail(p: { link: string; current: boolean; newEmail: string }) {
  if (p.current) {
    const subject = "Din e-mail i Rolff er ved at blive ændret";
    const what = `Der er bedt om at ændre e-mailen på din Rolff-konto til <strong>${esc(p.newEmail)}</strong> (med din adgangskode). Ændringen sker, når den nye adresse bekræftes.`;
    const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p><p style="margin:0 0 14px">${what}</p>
<p style="margin:0;font-size:14px">Var det ikke dig? Så log ind og skift din adgangskode med det samme (⋮ → Konto), eller brug "Glemt adgangskode".</p>`);
    const text = `Hej,\n\n${what.replace(/<[^>]+>/g, "")}\n\nVar det ikke dig? Så log ind og skift din adgangskode med det samme (⋮ → Konto), eller brug "Glemt adgangskode".`;
    return { subject, html, text };
  }
  const subject = "Bekræft din nye e-mail i Rolff";
  const what = "Bekræft, at denne adresse skal bruges til din Rolff-konto. Linket virker én gang og udløber efter en time.";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p><p style="margin:0 0 22px">${what}</p>${btn(p.link, "Bekræft")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Har du ikke bedt om det, så ignorer mailen.</p>`);
  const text = `Hej,\n\n${what}\n${p.link}\n\nHar du ikke bedt om det, så ignorer mailen.`;
  return { subject, html, text };
}
