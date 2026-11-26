// Full transcript of every conversation the caller can see (same visibility as export-data /
// get_messages). Used before account deletion. The e-mail body never contains message content;
// the HTML attachment does. Dependencies are injected so tests never send real mail.
import { accountTranscriptMail, type MailAttachment, type MailLang, mailLang } from "./email.ts";

export type TranscriptMessage = { created_at?: string; mine?: boolean; sender_name?: string; body?: string; file_name?: string };
export type TranscriptConv = { id: string; title: string; messages: TranscriptMessage[] };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fmt = (d: string, lang: MailLang) => {
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return d;
  return new Date(t).toLocaleString(lang === "en" ? "en-GB" : "da-DK", { timeZone: "Europe/Copenhagen", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

function convTitle(c: { others?: { email?: string; alias?: string }[] }, lang: MailLang): string {
  const names = (c.others ?? []).map((o) => (o.alias || o.email || "").trim()).filter(Boolean);
  if (names.length) return names.join(", ");
  return lang === "en" ? "Conversation" : "Samtale";
}

/** Readable HTML file (attachment only). Every user-provided string is escaped. */
export function buildTranscriptHtml(convs: TranscriptConv[], p: { generatedAt: string; lang?: MailLang }): string {
  const lang = mailLang(p.lang);
  const da = lang === "da";
  const title = da ? "Udskrift af dine samtaler i Rolff" : "Transcript of your conversations in Rolff";
  const when = fmt(p.generatedAt, lang);
  const parts: string[] = [
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`,
    `<style>body{font:16px/1.45 system-ui,-apple-system,sans-serif;color:#1d2a2a;max-width:720px;margin:24px auto;padding:0 16px}h1{font-size:22px}h2{font-size:18px;margin:28px 0 8px}p,li{overflow-wrap:anywhere}.meta{color:#5b6b6a;font-size:13px}.msg{margin:0 0 10px;padding:8px 0;border-bottom:1px solid #eee}.who{font-weight:650}</style></head><body>`,
    `<h1>${esc(title)}</h1><p class="meta">${esc(when)} · ${convs.length} ${da ? "samtaler" : "conversations"}</p>`,
  ];
  if (!convs.length) parts.push(`<p>${da ? "Du har ingen samtaler." : "You have no conversations."}</p>`);
  for (const c of convs) {
    parts.push(`<h2>${esc(c.title)}</h2>`);
    if (!c.messages.length) {
      parts.push(`<p class="meta">${da ? "Ingen beskeder." : "No messages."}</p>`);
      continue;
    }
    for (const m of c.messages) {
      const who = m.mine ? (da ? "Dig" : "You") : (m.sender_name || (da ? "Anden" : "Other"));
      const file = m.file_name ? ` [${da ? "Vedhæftet" : "Attachment"}: ${m.file_name}]` : "";
      const body = (m.body ?? "") + file;
      parts.push(`<div class="msg"><div class="meta"><span class="who">${esc(who)}</span> · ${esc(fmt(String(m.created_at ?? ""), lang))}</div><div>${esc(body)}</div></div>`);
    }
  }
  parts.push("</body></html>");
  return parts.join("");
}

const b64 = (s: string) => {
  const u = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(out);
};

export type TranscriptDeps = {
  listConversations: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  getMessages: (conv: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  mail: (to: string, m: { subject: string; html: string; text: string; attachments?: MailAttachment[] }) => Promise<boolean>;
};

/** Collects visible conversations, builds the attachment and queues the mail. Returns false if anything fails. */
export async function sendAccountTranscript(
  p: { email: string; lang?: MailLang },
  deps: TranscriptDeps,
): Promise<boolean> {
  const lang = mailLang(p.lang);
  const listed = await deps.listConversations();
  if (listed.error) return false;
  const rows = (listed.data ?? []) as { id: string; others?: { email?: string; alias?: string }[] }[];
  const convs: TranscriptConv[] = [];
  let messages = 0;
  for (const c of rows) {
    if (!c?.id) continue;
    const m = await deps.getMessages(c.id);
    if (m.error) return false;
    const msgs = ((m.data ?? []) as TranscriptMessage[]).map((x) => ({
      created_at: x.created_at, mine: x.mine, sender_name: x.sender_name, body: x.body, file_name: x.file_name,
    }));
    messages += msgs.length;
    convs.push({ id: c.id, title: convTitle(c, lang), messages: msgs });
  }
  const generatedAt = new Date().toISOString();
  const htmlFile = buildTranscriptHtml(convs, { generatedAt, lang });
  const mail = accountTranscriptMail({ conversations: convs.length, messages, lang });
  const day = generatedAt.slice(0, 10);
  const filename = `${lang === "en" ? "rolff-transcript" : "rolff-udskrift"}-${day}.html`;
  const attachment: MailAttachment = { filename, content_type: "text/html", content_b64: b64(htmlFile) };
  return await deps.mail(p.email, { ...mail, attachments: [attachment] });
}
