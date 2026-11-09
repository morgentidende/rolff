// Conversation list rows: latest-message excerpt and time label. Pure helpers (unit tested).
// The server (list_my_conversations_v2) only returns messages this user may see: own messages and
// messages released to them. Pending/held texts never reach the client here.
export type ConvPreview = {
  members?: number | null; last_at?: string | null; last_body?: string | null; last_mine?: boolean | null;
  last_sender_name?: string | null; last_att_mime?: string | null;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Today: HH:MM. Yesterday: "I går". Older: dd.mm.yy. Browser-local time, like message bubbles. */
export function listTime(iso: string | null | undefined, lang: string, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const loc = lang === "da" ? "da-DK" : "en-GB";
  if (dayKey(d) === dayKey(now)) return new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return lang === "da" ? "I går" : "Yesterday";
  return new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
}

/** One-line excerpt, or null when the conversation has no visible message. */
export function previewText(c: ConvPreview, da: boolean): string | null {
  if (!c.last_at) return null;
  const body = (c.last_body ?? "").replace(/\s+/g, " ").trim();
  let text = body;
  if (c.last_att_mime) {
    const img = c.last_att_mime.startsWith("image/");
    const icon = img ? "📷" : "📎";
    const label = img ? (da ? "Billede" : "Photo") : c.last_att_mime === "application/pdf" ? "PDF" : (da ? "Vedhæftet fil" : "Attachment");
    text = `${icon} ${body || label}`;
  }
  if (!text) return null;
  if (c.last_mine) return `${da ? "Dig" : "You"}: ${text}`;
  if ((c.members ?? 0) > 2 && c.last_sender_name) return `${c.last_sender_name}: ${text}`;
  return text;
}
