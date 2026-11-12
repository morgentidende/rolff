import { appUrl } from "./links.ts";
// Invitation e-mail templates. Never include message content.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export type MailLang = "da" | "en";
/** Only "da" or "en" are accepted; anything else (missing, garbage) falls back to Danish. */
export const mailLang = (v: unknown): MailLang => v === "en" ? "en" : "da";
/** First explicit da/en wins; otherwise Danish. */
export const preferLang = (...cands: unknown[]): MailLang => {
  for (const c of cands) if (c === "en" || c === "da") return c;
  return "da";
};
/** Look up a stored profile language (locale_of / locale_for_email). Errors and missing rows -> da. */
export async function storedLang(
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>,
  args: { uid?: string; email?: string },
): Promise<MailLang> {
  return (await storedLangIfSet(rpc, args)) ?? "da";
}
/** Stored da/en if one is recorded; null when there is no account or the lookup fails. */
export async function storedLangIfSet(
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>,
  args: { uid?: string; email?: string },
): Promise<MailLang | null> {
  try {
    const data = args.uid ? (await rpc("locale_of", { p_uid: args.uid })).data
      : args.email ? (await rpc("locale_for_email", { p_email: args.email })).data
      : null;
    return data === "en" || data === "da" ? data : null;
  } catch { return null; }
}
const fmt = (d: string, lang: MailLang = "da") => new Date(d).toLocaleString(lang === "en" ? "en-GB" : "da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const logoUrl = () => `${appUrl()}icons/rolff-128.png`;
const SHELL_TXT = {
  da: { tagline: "Rolig, saglig kommunikation i konflikter", banner: "<strong>⚠ Dette er en testversion af Rolff</strong> – brug den ikke til rigtige sager eller følsomme oplysninger." },
  en: { tagline: "Calm, factual communication in conflicts", banner: "<strong>⚠ This is a test version of Rolff</strong> – do not use it for real cases or sensitive information." },
};
function shell(title: string, inner: string, lang: MailLang = "da") {
  const L = SHELL_TXT[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2f2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
<tr><td bgcolor="#016C72" style="background:#016C72;padding:20px 28px;color:#ffffff">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="48" style="width:48px;padding-right:14px;vertical-align:middle"><img src="${logoUrl()}" width="48" height="48" alt="Rolff logo" style="display:block;width:48px;height:48px;border:0;border-radius:11px;background:#016C72;color:#ffffff;font-size:12px"></td>
<td style="vertical-align:middle;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.3px">Rolff<div style="font-size:13px;font-weight:400;opacity:.85;margin-top:2px">${L.tagline}</div></td>
</tr></table></td></tr>
<tr><td style="padding:14px 28px;background:#fff4d6;border-bottom:1px solid #f0dfa8;font-size:14px;line-height:1.45;color:#5a4300" role="note">${L.banner}</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#7a807e;border-top:1px solid #eeeae3"><strong>Testversion.</strong> Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift, og data kan blive slettet.<br><em>Test version. Do not enter real or sensitive information. Messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off). No uptime guarantee; data may be deleted.</em></td></tr>
</table></td></tr></table></body></html>`;
}

/** Bilingual test-version footer of the plain-text part (unchanged wording, same in both languages). */
const TEXT_FOOT = "Rolff (testversion): Skriv ikke rigtige eller følsomme oplysninger. Beskeder tjekkes af OpenAI (USA/global behandling, ikke EU; ingen Zero Data Retention endnu; gemning slået fra). Ingen garanti for drift; data kan blive slettet. / Test version: do not enter real or sensitive information; messages are checked by OpenAI (US/global processing, not EU; no Zero Data Retention yet; storage turned off); no uptime guarantee; data may be deleted.";
const TESTWARN = "!! Dette er en testversion af Rolff – brug den ikke til rigtige sager eller følsomme oplysninger. !!\n\n";
const TESTWARN_EN = "!! This is a test version of Rolff – do not use it for real cases or sensitive information. !!\n\n";

export function inviteMail(p: { inviterEmail: string; link: string; expires: string; inviteeEmail?: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = `${p.inviterEmail} has invited you to Rolff`;
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviterEmail)}</strong> has invited you to a shared conversation in Rolff – a calm chat where messages are checked for tone before they are sent.</p>
<p style="margin:0 0 22px">Tap the button to choose a password and join the conversation.</p>
${inviteBlock(p.link, p.inviteeEmail, p.expires, lang)}`, lang);
    const text = `${TESTWARN_EN}Hi,\n\n${p.inviterEmail} has invited you to a shared conversation in Rolff.\n\nOpen the invitation: ${p.link}\n\nThe invitation was sent to ${p.inviteeEmail ?? ""}. The link works once and expires ${fmt(p.expires, lang)} (3 days). Only this e-mail address can use it.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = `${p.inviterEmail} har inviteret dig til Rolff`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviterEmail)}</strong> har inviteret dig til en fælles samtale i Rolff – en rolig chat, hvor beskeder bliver tjekket for tonen, før de sendes.</p>
<p style="margin:0 0 22px">Tryk på knappen for at vælge en adgangskode og komme ind i samtalen.</p>
${inviteBlock(p.link, p.inviteeEmail, p.expires, lang)}`, lang);
  const text = `${TESTWARN}Hej,\n\n${p.inviterEmail} har inviteret dig til en fælles samtale i Rolff.\n\nÅbn invitationen: ${p.link}\n\nInvitationen er sendt til ${p.inviteeEmail ?? ""}. Linket virker én gang og udløber ${fmt(p.expires)} (3 dage). Kun denne e-mailadresse kan bruge det.\n\n${TEXT_FOOT}`;
  return { subject, html, text };
}

export function copyMail(p: { inviteeEmail: string; expires: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = `Copy: Your invitation to ${p.inviteeEmail} has been sent`;
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px">Your invitation to <strong>${esc(p.inviteeEmail)}</strong> has been sent. Once it is accepted, you will both find the conversation in Rolff.</p>
<p style="margin:0;font-size:13px;color:#7a807e">For security, the link is only in the recipient's e-mail. The invitation expires ${esc(fmt(p.expires, lang))}.</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\nYour invitation to ${p.inviteeEmail} has been sent. The link is only in the recipient's e-mail. Expires ${fmt(p.expires, lang)}.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = `Kopi: Din invitation til ${p.inviteeEmail} er sendt`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Din invitation til <strong>${esc(p.inviteeEmail)}</strong> er sendt. Når invitationen er taget imod, finder I samtalen i Rolff.</p>
<p style="margin:0;font-size:13px;color:#7a807e">Af sikkerhedshensyn er linket kun med i modtagerens mail. Invitationen udløber ${esc(fmt(p.expires))}.</p>`, lang);
  const text = `${TESTWARN}Hej,\n\nDin invitation til ${p.inviteeEmail} er sendt. Linket er kun med i modtagerens mail. Udløber ${fmt(p.expires)}.\n\n${TEXT_FOOT}`;
  return { subject, html, text };
}

/** Button + plain text link + who it is for. Used by every invitation mail. */
const inviteBlock = (link: string, invitee: string | undefined, expires: string, lang: MailLang = "da") => lang === "en"
  ? `${button(link, "Open the invitation")}
<p style="margin:18px 0 0;font-size:13px;color:#4d5351">Button not working? Copy this link into your browser:<br><a href="${esc(link)}" style="color:#016C72;word-break:break-all">${esc(link)}</a></p>
<p style="margin:14px 0 0;font-size:13px;color:#4d5351">The invitation was sent to <strong>${esc(invitee ?? "")}</strong>. The link works <strong>once</strong> and expires <strong>${esc(fmt(expires, lang))}</strong> (3 days). If you do not know the sender, you can simply delete this e-mail.</p>`
  : `${button(link, "Åbn invitationen")}
<p style="margin:18px 0 0;font-size:13px;color:#4d5351">Virker knappen ikke? Kopiér dette link ind i din browser:<br><a href="${esc(link)}" style="color:#016C72;word-break:break-all">${esc(link)}</a></p>
<p style="margin:14px 0 0;font-size:13px;color:#4d5351">Invitationen er sendt til <strong>${esc(invitee ?? "")}</strong>. Linket virker <strong>én gang</strong> og udløber <strong>${esc(fmt(expires))}</strong> (3 dage). Kender du ikke afsenderen, kan du bare slette mailen.</p>`;
const roleDa = (r: string) => r === "reader" ? "kun læse" : "læse og skrive";
const roleEn = (r: string) => r === "reader" ? "read only" : "read and write";
const button = (link: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#016C72" style="border-radius:10px;background:#016C72"><a href="${esc(link)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">${esc(label)}</a></td></tr></table>`;

/** To existing members: someone asks to add a participant. No names, no message content. */
export function approvalMail(p: { role: string; appUrl: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = "Rolff: Approve or decline a new participant";
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px">A member of one of your conversations in Rolff would like to add a new participant who will be able to <strong>${roleEn(p.role)}</strong>.</p>
<p style="margin:0 0 22px">The new participant only gets access once everyone in the conversation has approved. One refusal stops the invitation. The participant sees no messages from before they joined.</p>
${button(p.appUrl, "Open Rolff to respond")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Log in and open the conversation to see who it is about and to approve or decline.</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\nA member of one of your conversations in Rolff would like to add a new participant (${roleEn(p.role)}). The participant only gets access once everyone has approved. One refusal stops the invitation.\n\nOpen Rolff to respond: ${p.appUrl}\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = "Rolff: Godkend eller afvis en ny deltager";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Et medlem af en af dine samtaler i Rolff vil gerne tilføje en ny deltager, som skal kunne <strong>${roleDa(p.role)}</strong>.</p>
<p style="margin:0 0 22px">Den nye deltager får først adgang, når alle i samtalen har godkendt. Ét afslag stopper invitationen. Deltageren ser ingen beskeder fra før, hun eller han kom med.</p>
${button(p.appUrl, "Åbn Rolff for at svare")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Log ind og åbn samtalen for at se, hvem det drejer sig om, og for at godkende eller afvise.</p>`, lang);
  const text = `${TESTWARN}Hej,\n\nEt medlem af en af dine samtaler i Rolff vil gerne tilføje en ny deltager (${roleDa(p.role)}). Deltageren får først adgang, når alle har godkendt. Ét afslag stopper invitationen.\n\nÅbn Rolff for at svare: ${p.appUrl}\n\n${TEXT_FOOT}`;
  return { subject, html, text };
}

/** To the extra participant after unanimous approval. */
export function memberInviteMail(p: { inviterEmail: string; link: string; expires: string; role: string; inviteeEmail?: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const verb = p.role === "reader" ? "follow" : "take part in";
    const subject = `${p.inviterEmail} has invited you to ${verb} a conversation in Rolff`;
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviterEmail)}</strong> has invited you to <strong>${verb}</strong> a conversation in Rolff (access: ${roleEn(p.role)}). Everyone in the conversation has approved the invitation.</p>
<p style="margin:0 0 22px">You only see messages from after you joined.</p>
${inviteBlock(p.link, p.inviteeEmail, p.expires, lang)}`, lang);
    const text = `${TESTWARN_EN}Hi,\n\n${p.inviterEmail} has invited you to ${verb} a conversation in Rolff (access: ${roleEn(p.role)}).\n\nOpen the invitation: ${p.link}\n\nThe invitation was sent to ${p.inviteeEmail ?? ""}. The link works once and expires ${fmt(p.expires, lang)} (3 days). Only this e-mail address can use it.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const verb = p.role === "reader" ? "læse med" : "deltage";
  const subject = `${p.inviterEmail} har inviteret dig til at ${verb} i en samtale i Rolff`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px"><strong>${esc(p.inviterEmail)}</strong> har inviteret dig til at <strong>${verb}</strong> i en samtale i Rolff (adgang: ${roleDa(p.role)}). Alle i samtalen har godkendt invitationen.</p>
<p style="margin:0 0 22px">Du ser kun beskeder fra efter, du er kommet med.</p>
${inviteBlock(p.link, p.inviteeEmail, p.expires, lang)}`, lang);
  const text = `${TESTWARN}Hej,\n\n${p.inviterEmail} har inviteret dig til at ${verb} i en samtale i Rolff (adgang: ${roleDa(p.role)}).\n\nÅbn invitationen: ${p.link}\n\nInvitationen er sendt til ${p.inviteeEmail ?? ""}. Linket virker én gang og udløber ${fmt(p.expires)} (3 dage). Kun denne e-mailadresse kan bruge det.\n\n${TEXT_FOOT}`;
  return { subject, html, text };
}

/** Feedback/report senders are identified by user id; a name is only shown if one is passed. */
const senderPrefix = (n: string) => n && n !== "–" ? `${esc(n)} · ` : "";
const CATS: Record<string, string> = { suggestion: "Forslag", complaint: "Klage", filter: "Filter-feedback", idea: "Forslag", problem: "Klage", other: "Andet" };
/** Feedback to the team. Category is whitelisted; text and sender are escaped. Never conversation content. */
export function feedbackMail(p: { category: string; body: string; senderName: string; senderId: string }) {
  const cat = CATS[p.category] ?? "Andet";
  const subject = `Rolff feedback: ${cat}`;
  const html = shell(subject, `<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Kategori</p><p style="margin:0 0 16px"><strong>${esc(cat)}</strong></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Fra (bruger-id)</p><p style="margin:0 0 16px">${senderPrefix(p.senderName)}<code>${esc(p.senderId)}</code></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Feedback</p><div style="margin:0;padding:14px 16px;background:#f6f4ef;border-radius:10px;white-space:pre-wrap;word-break:break-word">${esc(p.body)}</div>`);
  const text = `Rolff feedback\n\nKategori: ${cat}\nFra: ${p.senderName} (${p.senderId})\n\n${p.body}\n`;
  return { subject, html, text };
}

export type MailAttachment = { filename: string; content_type: "application/pdf"; content_b64: string };
export async function sendMail(to: string, m: { subject: string; html: string; text: string; reply_to?: string; attachments?: MailAttachment[] }): Promise<boolean> {
  const url = Deno.env.get("MAILER_URL"), secret = Deno.env.get("MAILER_SECRET");
  if (!url || !secret) return false;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-rolff-secret": secret }, body: JSON.stringify({ to, ...m }), signal: AbortSignal.timeout(m.attachments?.length ? 30000 : 10000) });
    return r.ok;
  } catch { return false; }
}

const btn = (link: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#016C72" style="border-radius:10px;background:#016C72"><a href="${esc(link)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px">${esc(label)}</a></td></tr></table>`;
export function inactivityMail(p: { link: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = "Your Rolff account will be deleted soon due to inactivity";
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px">You have not logged in to Rolff for a while. In 14 days we will automatically delete your account and your own data.</p>
<p style="margin:0 0 22px">If you want to keep the account, just log in. You can also turn off automatic deletion under ⋮ → Privacy.</p>
${btn(p.link, "Log in")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">What you have written to others stays with them – even after deletion.</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\nYou have not logged in to Rolff for a while. In 14 days we will automatically delete your account and your own data. Log in to keep it: ${p.link}\nYou can turn off automatic deletion under ⋮ → Privacy.\n\nWhat you have written to others stays with them – even after deletion.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = "Din Rolff-konto slettes snart på grund af inaktivitet";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Du har ikke logget ind i Rolff i et stykke tid. Om 14 dage sletter vi din konto og dine egne data automatisk.</p>
<p style="margin:0 0 22px">Vil du beholde kontoen, skal du bare logge ind. Du kan også slå automatisk sletning fra under ⋮ → Privatliv.</p>
${btn(p.link, "Log ind")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Det, du har skrevet til andre, bliver hos dem – også efter sletning.</p>`, lang);
  const text = `${TESTWARN}Hej,\n\nDu har ikke logget ind i Rolff i et stykke tid. Om 14 dage sletter vi din konto og dine egne data automatisk. Log ind for at beholde den: ${p.link}\nDu kan slå automatisk sletning fra under ⋮ → Privatliv.\n\nDet, du har skrevet til andre, bliver hos dem – også efter sletning.`;
  return { subject, html, text };
}

export const REPORT_LABELS: Record<string, string> = { harassment: "Chikane/trusler", inappropriate: "Upassende indhold", child_safety: "Børns sikkerhed", other: "Andet" };
export function reportMail(p: { category: string; body: string; senderName: string; senderId: string; conversationId: string; messages: { sender_name: string; body: string; created_at: string }[] }) {
  const cat = REPORT_LABELS[p.category] ?? "Andet";
  const subject = `Rolff rapport: ${cat}`;
  const msgs = p.messages.map((m) => `<div style="margin:0 0 10px;padding:10px 14px;background:#f6f4ef;border-radius:10px"><div style="font-size:12px;color:#7a807e">${esc(m.sender_name)} · ${esc(String(m.created_at))}</div><div style="white-space:pre-wrap;word-break:break-word">${esc(m.body)}</div></div>`).join("");
  const html = shell(subject, `<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Kategori</p><p style="margin:0 0 16px"><strong>${esc(cat)}</strong></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Fra (bruger-id) · samtale</p><p style="margin:0 0 16px">${senderPrefix(p.senderName)}<code>${esc(p.senderId)}</code> · <code>${esc(p.conversationId)}</code></p>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Beskrivelse</p><div style="margin:0 0 16px;padding:14px 16px;background:#f6f4ef;border-radius:10px;white-space:pre-wrap;word-break:break-word">${esc(p.body || "–")}</div>
<p style="margin:0 0 6px;font-size:13px;color:#7a807e">Vedhæftede beskeder valgt af brugeren (${p.messages.length})</p>${msgs || "<p>–</p>"}`);
  const text = `Rolff rapport\n\nKategori: ${cat}\nFra: ${p.senderName} (${p.senderId})\nSamtale: ${p.conversationId}\n\n${p.body || "–"}\n\nVedhæftede beskeder (${p.messages.length}):\n` + p.messages.map((m) => `[${m.created_at}] ${m.sender_name}: ${m.body}`).join("\n") + "\n";
  return { subject, html, text };
}

export function recoveryMail(p: { link: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = "Reset your Rolff password";
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 22px">Someone (hopefully you) asked to reset the password for your Rolff account. Tap the button to choose a new one. The link works once and expires shortly.</p>
${btn(p.link, "Choose a new password")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">If you did not ask for this, you can ignore this e-mail. Your password will not change.</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\nSomeone (hopefully you) asked to reset the password for your Rolff account. Choose a new one here (works once, expires shortly):\n${p.link}\n\nIf you did not ask for this, you can ignore this e-mail. Your password will not change.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = "Nulstil din adgangskode til Rolff";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 22px">Nogen (forhåbentlig dig) har bedt om at nulstille adgangskoden til din Rolff-konto. Tryk på knappen for at vælge en ny. Linket virker én gang og udløber efter kort tid.</p>
${btn(p.link, "Vælg ny adgangskode")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Har du ikke bedt om det, kan du se bort fra denne mail. Din adgangskode ændres ikke.</p>`, lang);
  const text = `${TESTWARN}Hej,\n\nNogen (forhåbentlig dig) har bedt om at nulstille adgangskoden til din Rolff-konto. Vælg en ny her (virker én gang, udløber efter kort tid):\n${p.link}\n\nHar du ikke bedt om det, kan du se bort fra denne mail.`;
  return { subject, html, text };
}
export function emailChangeMail(p: { link: string; current: boolean; newEmail: string; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (p.current) {
    if (lang === "en") {
      const subject = "Your e-mail in Rolff is about to be changed";
      const what = `A request was made (with your password) to change the e-mail on your Rolff account to <strong>${esc(p.newEmail)}</strong>. The change happens when the new address is confirmed.`;
      const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p><p style="margin:0 0 14px">${what}</p>
<p style="margin:0;font-size:14px">If this was not you, log in and change your password at once (⋮ → Account), or use "Forgot password".</p>`, lang);
      const text = `${TESTWARN_EN}Hi,\n\n${what.replace(/<[^>]+>/g, "")}\n\nIf this was not you, log in and change your password at once (⋮ → Account), or use "Forgot password".\n\n${TEXT_FOOT}`;
      return { subject, html, text };
    }
    const subject = "Din e-mail i Rolff er ved at blive ændret";
    const what = `Der er bedt om at ændre e-mailen på din Rolff-konto til <strong>${esc(p.newEmail)}</strong> (med din adgangskode). Ændringen sker, når den nye adresse bekræftes.`;
    const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p><p style="margin:0 0 14px">${what}</p>
<p style="margin:0;font-size:14px">Var det ikke dig? Så log ind og skift din adgangskode med det samme (⋮ → Konto), eller brug "Glemt adgangskode".</p>`, lang);
    const text = `${TESTWARN}Hej,\n\n${what.replace(/<[^>]+>/g, "")}\n\nVar det ikke dig? Så log ind og skift din adgangskode med det samme (⋮ → Konto), eller brug "Glemt adgangskode".`;
    return { subject, html, text };
  }
  if (lang === "en") {
    const subject = "Confirm your new e-mail in Rolff";
    const what = "Confirm that this address should be used for your Rolff account. The link works once and expires after one hour.";
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p><p style="margin:0 0 22px">${what}</p>${btn(p.link, "Confirm")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">If you did not ask for this, ignore the e-mail.</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\n${what}\n${p.link}\n\nIf you did not ask for this, ignore the e-mail.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = "Bekræft din nye e-mail i Rolff";
  const what = "Bekræft, at denne adresse skal bruges til din Rolff-konto. Linket virker én gang og udløber efter en time.";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p><p style="margin:0 0 22px">${what}</p>${btn(p.link, "Bekræft")}
<p style="margin:22px 0 0;font-size:13px;color:#7a807e">Har du ikke bedt om det, så ignorer mailen.</p>`, lang);
  const text = `${TESTWARN}Hej,\n\n${what}\n${p.link}\n\nHar du ikke bedt om det, så ignorer mailen.`;
  return { subject, html, text };
}

/** Court export: PDF attached. No message content in the mail body. */
export function exportMail(p: { exporterEmail: string; toSelf: boolean; verifyUrl: string; code: string; exportId: string; scope: string; count: number; pages: number; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = p.toSelf ? "Your transcript of the conversation from Rolff" : `${p.exporterEmail} has sent you a transcript of a conversation from Rolff`;
    const intro = p.toSelf ? "Here is the transcript of the conversation you asked for. It is attached as a PDF."
      : `<strong>${esc(p.exporterEmail)}</strong> has asked Rolff to send you a transcript of a conversation. It is attached as a PDF.`;
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p><p style="margin:0 0 14px">${intro}</p>
<p style="margin:0 0 14px;font-size:14px">${esc(p.scope)} · ${p.count} messages · ${p.pages} pages<br>Export ID: <code>${esc(p.exportId)}</code></p>
<p style="margin:0 0 8px"><strong>How to check that the transcript is genuine and unchanged</strong></p>
<ol style="margin:0 0 16px;padding-left:20px;font-size:14px"><li>The PDF is digitally signed by Rolff. In a PDF reader you can see the signature (test certificate – see below).</li>
<li>Open the page <a href="${esc(p.verifyUrl)}" style="color:#016C72">Check transcript</a> and choose the PDF file. The file is not sent – only its fingerprint (SHA-256) is calculated on your device and compared with Rolff's register.</li>
<li>You can also enter the code <strong>${esc(p.code)}</strong>, which is printed at the bottom of each page.</li></ol>
${button(p.verifyUrl, "Check transcript")}
<p style="margin:18px 0 0;font-size:13px;color:#7a807e">If a single character in the file is changed, the check will not match. The transcript contains only messages the sender of the transcript themselves has access to. In the test version the signature is made with a self-issued test certificate, which PDF readers show as an "unknown issuer". Rolff cannot assess how a court or authority will use the transcript.</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\n${p.toSelf ? "Here is the transcript of the conversation you asked for (PDF attached)." : `${p.exporterEmail} has asked Rolff to send you a transcript of a conversation (PDF attached).`}\n\n${p.scope} · ${p.count} messages · ${p.pages} pages\nExport ID: ${p.exportId}\n\nCheck authenticity: open ${p.verifyUrl} and choose the PDF file (the file is not sent – only the fingerprint is calculated on your device), or enter the code ${p.code}. The PDF is also digitally signed by Rolff (test certificate in the test version).\n\nIf a single character in the file is changed, the check will not match. Rolff cannot assess how a court or authority will use the transcript.\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = p.toSelf ? "Din udskrift af samtalen fra Rolff" : `${p.exporterEmail} har sendt dig en udskrift af en samtale fra Rolff`;
  const intro = p.toSelf ? "Her er den udskrift af samtalen, du bad om. Den ligger som PDF i denne mail."
    : `<strong>${esc(p.exporterEmail)}</strong> har bedt Rolff sende dig en udskrift af en samtale. Den ligger som PDF i denne mail.`;
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p><p style="margin:0 0 14px">${intro}</p>
<p style="margin:0 0 14px;font-size:14px">${esc(p.scope)} · ${p.count} beskeder · ${p.pages} sider<br>Eksport-ID: <code>${esc(p.exportId)}</code></p>
<p style="margin:0 0 8px"><strong>Sådan kontrollerer du, at udskriften er ægte og uændret</strong></p>
<ol style="margin:0 0 16px;padding-left:20px;font-size:14px"><li>PDF'en er digitalt signeret af Rolff. I en PDF-læser kan du se signaturen (testcertifikat – se nedenfor).</li>
<li>Åbn siden <a href="${esc(p.verifyUrl)}" style="color:#016C72">Tjek udskrift</a> og vælg PDF-filen. Filen sendes ikke – kun dens fingeraftryk (SHA-256) beregnes på din enhed og sammenlignes med Rolffs register.</li>
<li>Du kan også indtaste koden <strong>${esc(p.code)}</strong>, som står nederst på hver side.</li></ol>
${button(p.verifyUrl, "Tjek udskrift")}
<p style="margin:18px 0 0;font-size:13px;color:#7a807e">Ændres blot ét tegn i filen, stemmer kontrollen ikke. Udskriften indeholder kun beskeder, som afsenderen af udskriften selv har adgang til. I testversionen er signaturen lavet med et selvudstedt testcertifikat, som PDF-læsere viser som "ukendt udsteder". Rolff kan ikke vurdere, hvordan en domstol eller myndighed vil bruge udskriften.</p>`, lang);
  const text = `${TESTWARN}Hej,\n\n${p.toSelf ? "Her er den udskrift af samtalen, du bad om (PDF vedhæftet)." : `${p.exporterEmail} har bedt Rolff sende dig en udskrift af en samtale (PDF vedhæftet).`}\n\n${p.scope} · ${p.count} beskeder · ${p.pages} sider\nEksport-ID: ${p.exportId}\n\nKontrollér ægthed: åbn ${p.verifyUrl} og vælg PDF-filen (filen sendes ikke – kun fingeraftrykket beregnes på din enhed), eller indtast koden ${p.code}. PDF'en er også digitalt signeret af Rolff (testcertifikat i testversionen).\n\nÆndres blot ét tegn i filen, stemmer kontrollen ikke. Rolff kan ikke vurdere, hvordan en domstol eller myndighed vil bruge udskriften.`;
  return { subject, html, text };
}
/** To the account e-mail when an export was sent to another address. */
export function exportNoticeMail(p: { recipient: string; exportId: string; scope: string; count: number; lang?: MailLang }) {
  const lang = mailLang(p.lang);
  if (lang === "en") {
    const subject = "Rolff: You have sent a transcript of a conversation";
    const html = shell(subject, `<p style="margin:0 0 14px">Hi,</p>
<p style="margin:0 0 14px">A transcript of a conversation has just been sent from your Rolff account to <strong>${esc(p.recipient)}</strong>.</p>
<p style="margin:0 0 14px;font-size:14px">${esc(p.scope)} · ${p.count} messages<br>Export ID: <code>${esc(p.exportId)}</code></p>
<p style="margin:0;font-size:14px">If this was not you, log in and change your password at once (⋮ → Account).</p>`, lang);
    const text = `${TESTWARN_EN}Hi,\n\nA transcript of a conversation has just been sent from your Rolff account to ${p.recipient}.\n${p.scope} · ${p.count} messages\nExport ID: ${p.exportId}\n\nIf this was not you, log in and change your password at once (⋮ → Account).\n\n${TEXT_FOOT}`;
    return { subject, html, text };
  }
  const subject = "Rolff: Du har sendt en udskrift af en samtale";
  const html = shell(subject, `<p style="margin:0 0 14px">Hej,</p>
<p style="margin:0 0 14px">Fra din Rolff-konto er der netop sendt en udskrift af en samtale til <strong>${esc(p.recipient)}</strong>.</p>
<p style="margin:0 0 14px;font-size:14px">${esc(p.scope)} · ${p.count} beskeder<br>Eksport-ID: <code>${esc(p.exportId)}</code></p>
<p style="margin:0;font-size:14px">Var det ikke dig? Log ind og skift din adgangskode med det samme (⋮ → Konto).</p>`, lang);
  const text = `${TESTWARN}Hej,\n\nFra din Rolff-konto er der netop sendt en udskrift af en samtale til ${p.recipient}.\n${p.scope} · ${p.count} beskeder\nEksport-ID: ${p.exportId}\n\nVar det ikke dig? Log ind og skift din adgangskode med det samme (⋮ → Konto).`;
  return { subject, html, text };
}
