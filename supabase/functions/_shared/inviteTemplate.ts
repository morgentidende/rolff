// Design of the real invitation e-mail ("X has invited you to chat on Rolff").
// Pure layout: no I/O, no secrets, no message content, no model/provider name in the explanation.
// Table layout + inline CSS (works in Gmail, Apple Mail, Outlook), 600 px max width, fluid on phones,
// and a dark-mode variant (prefers-color-scheme) that is also safe in clients that only auto-invert.
export type InviteMailLang = "da" | "en";
export type InviteMailParts = {
  lang: InviteMailLang; inviter: string; invitee: string; link: string; expires: string; logo: string;
  subject: string; footerHtml: string; footerText: string; policyUrl: string;
};
export type CopyMailParts = {
  lang: InviteMailLang; invitee: string; expires: string; appUrl: string; logo: string;
  subject: string; footerHtml: string; footerText: string;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const INVITE_COPY = {
  da: {
    headline: (n: string) => `${n} har inviteret dig til at chatte på Rolff`,
    preheader: "Tryk på knappen for at tage imod invitationen og komme ind i samtalen.",
    hi: "Hej,",
    about: "Rolff er en rolig chat, hvor beskeder bliver tjekket for en respektfuld tone, før de sendes. Der er ingen læsekvitteringer, så ingen kan se, om og hvornår du har læst en besked.",
    step: "Du vælger selv en adgangskode, når du tager imod invitationen.",
    cta: "Deltag i chatten",
    fallback: "Virker knappen ikke? Kopiér dette link ind i din browser:",
    expiry: (d: string) => `Invitationen udløber <strong>${d}</strong>, og linket virker <strong>én gang</strong>.`,
    expiryText: (d: string) => `Invitationen udløber ${d}, og linket virker én gang (3 dage).`,
    sentTo: (e: string) => `Den er sendt til <strong>${e}</strong>, og kun denne mailadresse kan bruge den.`,
    sentToText: (e: string) => `Den er sendt til ${e}, og kun denne mailadresse kan bruge den.`,
    ignore: "Hvis du ikke kender afsenderen, kan du ignorere mailen.",
    why: "Du får denne mail, fordi en bruger af Rolff har inviteret dig. Vi bruger din e-mail til at sende invitationen (berettiget interesse). Invitationen udløber efter 3 dage.",
    policy: "Privatlivspolitik",
    tagline: "Rolig chat med respektfuld tone",
    alt: "Rolff logo",
    notice: "Dette er en testversion – brug ikke rigtige eller følsomme oplysninger.",
    copy: {
      headline: "Din invitation er sendt",
      about: (e: string) => `Din invitation til <strong>${e}</strong> er afsendt. Når invitationen er taget imod, finder I samtalen i Rolff.`,
      aboutText: (e: string) => `Din invitation til ${e} er afsendt. Når invitationen er taget imod, finder I samtalen i Rolff.`,
      secure: "Af sikkerhedshensyn er linket kun med i modtagerens mail.",
      expiry: (d: string) => `Invitationen udløber <strong>${d}</strong>.`,
      expiryText: (d: string) => `Invitationen udløber ${d}.`,
      preheader: "Din invitation er afsendt.",
      cta: "Åbn Rolff",
    },
  },
  en: {
    headline: (n: string) => `${n} invited you to chat on Rolff`,
    preheader: "Tap the button to accept the invitation and join the conversation.",
    hi: "Hi,",
    about: "Rolff is a calm chat where messages are checked for a respectful tone before they are sent. There are no read receipts, so nobody can see if or when you have read a message.",
    step: "You choose your own password when you accept the invitation.",
    cta: "Join the chat",
    fallback: "Button not working? Copy this link into your browser:",
    expiry: (d: string) => `The invitation expires <strong>${d}</strong>, and the link works <strong>once</strong>.`,
    expiryText: (d: string) => `The invitation expires ${d}, and the link works once (3 days).`,
    sentTo: (e: string) => `It was sent to <strong>${e}</strong>, and only this e-mail address can use it.`,
    sentToText: (e: string) => `It was sent to ${e}, and only this e-mail address can use it.`,
    ignore: "If you do not know the sender, you can ignore this e-mail.",
    why: "You are receiving this e-mail because a Rolff user invited you. We use your e-mail to deliver the invitation (legitimate interest). The invitation expires after 3 days.",
    policy: "Privacy policy",
    tagline: "Calm chat with a respectful tone",
    alt: "Rolff logo",
    notice: "This is a test version – do not enter real or sensitive information.",
    copy: {
      headline: "Your invitation has been sent",
      about: (e: string) => `Your invitation to <strong>${e}</strong> has been sent. Once it is accepted, you will both find the conversation in Rolff.`,
      aboutText: (e: string) => `Your invitation to ${e} has been sent. Once it is accepted, you will both find the conversation in Rolff.`,
      secure: "For security, the link is only in the recipient's e-mail.",
      expiry: (d: string) => `The invitation expires <strong>${d}</strong>.`,
      expiryText: (d: string) => `The invitation expires ${d}.`,
      preheader: "Your invitation has been sent.",
      cta: "Open Rolff",
    },
  },
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// Brand teal = the app's --accent (#00788A light; #4AD8E4 on dark with #0e1414 text).
const CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
img{-ms-interpolation-mode:bicubic}
@media only screen and (max-width:480px){
  .px{padding-left:20px !important;padding-right:20px !important}
  .h1{font-size:24px !important;line-height:30px !important}
  .btn a{display:block !important;padding:17px 12px !important}
  .btn{width:100% !important}
  .outer{padding:12px 8px !important}
}
@media (prefers-color-scheme:dark){
  .bg{background:#141a1a !important;background-color:#141a1a !important}
  .card{background:#1d2525 !important;background-color:#1d2525 !important}
  .head{background:#0f4f53 !important;background-color:#0f4f53 !important}
  .tx{color:#e6eeec !important}
  .mut{color:#9fb0ad !important}
  .lnk{color:#4AD8E4 !important}
  .rule{border-color:#33403e !important}
  .btn td{background:#4AD8E4 !important;background-color:#4AD8E4 !important}
  .btn a{color:#0e1414 !important}
  .soft{background:#232c2c !important;background-color:#232c2c !important}
}
[data-ogsc] .tx{color:#e6eeec !important}[data-ogsc] .mut{color:#9fb0ad !important}
[data-ogsb] .bg{background:#141a1a !important}[data-ogsb] .card{background:#1d2525 !important}
`;

const unesc = (s: string) => s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[m]!));
type Frame = {
  lang: InviteMailLang; subject: string; preheader: string; logo: string; headline: string; bodyHtml: string;
  cta: { label: string; href: string }; belowCtaHtml: string; boxHtml: string; footerHtml: string;
};
/** Shared frame: teal header with logo, slim test notice, headline + body, one big button, info box, small footer. */
function frame(f: Frame): string {
  const L = INVITE_COPY[f.lang];
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f6f5;opacity:0">${esc(f.preheader)}${"&#847; &zwnj; ".repeat(20)}</div>`;
  return `<!doctype html><html lang="${f.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(f.subject)}</title><style>${CSS}</style></head>
<body class="bg" style="margin:0;padding:0;background:#f4f6f5;font-family:${FONT};color:#1d2a2a">
${preheader}
<table role="presentation" class="bg outer" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f5" style="background:#f4f6f5;padding:28px 12px"><tr><td align="center">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #d5dedc">
<tr><td class="head px" align="center" bgcolor="#00788A" style="background:#00788A;padding:30px 32px 26px;text-align:center">
<img src="${esc(f.logo)}" width="72" height="72" alt="${L.alt}" style="display:block;margin:0 auto;width:72px;height:72px;border:0;border-radius:18px;background:#00788A;color:#ffffff;font-size:14px;line-height:72px">
<div style="margin-top:14px;font-size:24px;line-height:28px;font-weight:700;letter-spacing:.4px;color:#ffffff">Rolff</div>
<div style="margin-top:4px;font-size:14px;line-height:20px;color:#d6efe9">${L.tagline}</div>
</td></tr>
<tr><td class="soft px" align="center" bgcolor="#eef3f2" style="background:#eef3f2;padding:8px 20px;border-bottom:1px solid #d5dedc" role="note"><p class="mut" style="margin:0;font-size:12px;line-height:17px;color:#5b6b6a">${esc(L.notice)}</p></td></tr>
<tr><td class="px" style="padding:34px 40px 8px">
<h1 class="h1 tx" style="margin:0 0 18px;font-size:28px;line-height:34px;font-weight:700;color:#1d2a2a;word-break:break-word">${f.headline}</h1>
${f.bodyHtml}
</td></tr>
<tr><td class="px" align="center" style="padding:0 40px 8px">
<table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%"><tr><td align="center" bgcolor="#00788A" style="border-radius:12px;background:#00788A">
<a href="${esc(f.cta.href)}" target="_blank" style="display:block;padding:18px 28px;font-family:${FONT};font-size:18px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${esc(f.cta.label)}</a>
</td></tr></table>
</td></tr>
${f.belowCtaHtml}
<tr><td class="px" style="padding:24px 40px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="soft" bgcolor="#f4f6f5" style="background:#f4f6f5;border-radius:12px;padding:16px 18px">
${f.boxHtml}
</td></tr></table>
</td></tr>
<tr><td class="px rule" style="padding:22px 40px 28px;border-top:1px solid #d5dedc">
<p class="mut" style="margin:0;font-size:11px;line-height:18px;color:#7a8785">${f.footerHtml}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
const P = (cls: string, color: string, size: number, lh: number, mb: number, html: string) => `<p class="${cls}" style="margin:0 0 ${mb}px;font-size:${size}px;line-height:${lh}px;color:${color}">${html}</p>`;

export function renderInviteMail(p: InviteMailParts): { html: string; text: string } {
  const L = INVITE_COPY[p.lang];
  const link = esc(p.link);
  const html = frame({
    lang: p.lang, subject: p.subject, preheader: L.preheader, logo: p.logo, headline: L.headline(esc(p.inviter)),
    bodyHtml: P("tx", "#1d2a2a", 16, 25, 14, L.hi) + P("tx", "#1d2a2a", 16, 25, 14, esc(L.about)) + P("mut", "#5b6b6a", 15, 23, 28, esc(L.step)),
    cta: { label: L.cta, href: p.link },
    belowCtaHtml: `<tr><td class="px" style="padding:20px 40px 8px"><p class="mut" style="margin:0;font-size:13px;line-height:20px;color:#5b6b6a">${esc(L.fallback)}<br><a class="lnk" href="${link}" target="_blank" style="color:#00788A;word-break:break-all">${link}</a></p></td></tr>`,
    boxHtml: P("tx", "#1d2a2a", 14, 21, 8, `${L.expiry(esc(p.expires))} ${L.sentTo(esc(p.invitee))}`) + P("mut", "#5b6b6a", 14, 21, 8, esc(L.why)) + P("mut", "#5b6b6a", 14, 21, 0, `${esc(L.ignore)} <a class="lnk" href="${esc(p.policyUrl)}" target="_blank" style="color:#00788A">${esc(L.policy)}</a>`),
    footerHtml: p.footerHtml,
  });
  const text = `${unesc(L.headline(esc(p.inviter)))}\n\n${L.hi}\n\n${L.about}\n${L.step}\n\n${L.cta}: ${p.link}\n\n${L.expiryText(p.expires)}\n${L.sentToText(p.invitee)}\n${L.why}\n${L.ignore}\n${L.policy}: ${p.policyUrl}\n\n${L.notice}\n--\nRolff · ${L.tagline}\n${p.footerText}`;
  return { html, text };
}

/** Confirmation copy to the inviter. Never contains the invitation link. */
export function renderCopyMail(p: CopyMailParts): { html: string; text: string } {
  const L = INVITE_COPY[p.lang], C = L.copy;
  const html = frame({
    lang: p.lang, subject: p.subject, preheader: C.preheader, logo: p.logo, headline: C.headline,
    bodyHtml: P("tx", "#1d2a2a", 16, 25, 14, L.hi) + P("tx", "#1d2a2a", 16, 25, 28, C.about(esc(p.invitee))),
    cta: { label: C.cta, href: p.appUrl }, belowCtaHtml: "",
    boxHtml: P("tx", "#1d2a2a", 14, 21, 8, C.expiry(esc(p.expires))) + P("mut", "#5b6b6a", 14, 21, 0, esc(C.secure)),
    footerHtml: p.footerHtml,
  });
  const text = `${C.headline}\n\n${L.hi}\n\n${C.aboutText(p.invitee)}\n\n${C.expiryText(p.expires)} ${C.secure}\n\n${C.cta}: ${p.appUrl}\n\n${L.notice}\n--\nRolff · ${L.tagline}\n${p.footerText}`;
  return { html, text };
}
