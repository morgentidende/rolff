// Conversation PDF export: a pure model (dates in the user's time zone, day grouping) and a
// layout that draws with jsPDF-compatible calls. No imports, so it can be unit-tested with a
// recording fake document. Runs on the device only; nothing here logs or sends message content.
export type ExportMessage = {
  id: string; sender_name: string | null; body: string; created_at: string; mine: boolean;
  att_mime?: string | null; att_name?: string | null; att_alt?: string | null; att_pages?: number | null;
  reply_to_id?: string | null; reply_body?: string | null; has_reply?: boolean;
};
export type ExportLang = "da" | "en";
export type ExportOptions = { lang: ExportLang; me: string; partners: string[]; timeZone?: string; now?: Date };

const loc = (lang: ExportLang) => (lang === "da" ? "da-DK" : "en-GB");
/** The device time zone – the same zone the chat view uses for message times. */
export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
function parts(d: Date, lang: ExportLang, timeZone: string | undefined, o: Intl.DateTimeFormatOptions) {
  const r: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(loc(lang), { ...o, timeZone }).formatToParts(d)) r[p.type] = p.value;
  return r;
}
/** YYYY-MM-DD in the given zone (used for grouping by day). */
export function isoDate(iso: string | Date, timeZone?: string): string {
  const p = parts(new Date(iso), "en", timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}
/** HH:MM (24h) in the given zone. */
export function isoTime(iso: string | Date, timeZone?: string): string {
  const p = parts(new Date(iso), "en", timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}
/** Message time as shown in the app (da: 14.05, en: 14:05). */
export function clock(iso: string | Date, lang: ExportLang, timeZone?: string): string {
  const p = parts(new Date(iso), lang, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}${lang === "da" ? "." : ":"}${p.minute}`;
}
const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
/** "6. november 2026" / "6 November 2026". */
export function longDate(iso: string | Date, lang: ExportLang, timeZone?: string): string {
  const p = parts(new Date(iso), lang, timeZone, { day: "numeric", month: "long", year: "numeric" });
  return lang === "da" ? `${p.day}. ${p.month} ${p.year}` : `${p.day} ${p.month} ${p.year}`;
}
/** Day separator: "Fredag 6. november 2026" / "Friday 6 November 2026". */
export function dayLabel(iso: string | Date, lang: ExportLang, timeZone?: string): string {
  const p = parts(new Date(iso), lang, timeZone, { weekday: "long" });
  return `${cap(p.weekday)} ${longDate(iso, lang, timeZone)}`;
}
export function period(msgs: { created_at: string }[], lang: ExportLang, timeZone?: string): string {
  if (!msgs.length) return "–";
  const a = msgs[0].created_at, b = msgs[msgs.length - 1].created_at;
  return isoDate(a, timeZone) === isoDate(b, timeZone) ? longDate(a, lang, timeZone) : `${longDate(a, lang, timeZone)} – ${longDate(b, lang, timeZone)}`;
}
export function attachmentText(m: ExportMessage, lang: ExportLang): string | null {
  if (!m.att_name && !m.att_mime) return null;
  const da = lang === "da";
  const kind = m.att_mime === "application/pdf" ? "PDF" : m.att_mime?.startsWith("image/") ? (da ? "billede" : "image") : (m.att_mime ?? "");
  const pages = m.att_pages ? `, ${m.att_pages} ${da ? (m.att_pages === 1 ? "side" : "sider") : (m.att_pages === 1 ? "page" : "pages")}` : "";
  return `${m.att_name || (da ? "Vedhæftning" : "Attachment")}${kind ? ` (${kind}${pages})` : ""}`;
}
export function replyText(m: ExportMessage, lang: ExportLang): string | null {
  if (!m.reply_to_id && !m.has_reply) return null;
  if (m.reply_body == null) return lang === "da" ? "Den oprindelige besked er ikke tilgængelig." : "The original message is unavailable.";
  const c = [...m.reply_body]; return c.length > 200 ? c.slice(0, 200).join("") + "…" : m.reply_body;
}
export const senderOf = (m: ExportMessage, me: string, lang: ExportLang) => m.mine ? (me || (lang === "da" ? "Dig" : "You")) : (m.sender_name || (lang === "da" ? "Ukendt afsender" : "Unknown sender"));

export type ExportItem = { m: ExportMessage; sender: string; time: string; showSender: boolean; reply: string | null; attachment: string | null };
export type ExportDay = { key: string; label: string; items: ExportItem[] };
export type ExportModel = {
  lang: ExportLang; title: string; partners: string; period: string; exportedBy: string; exportedAt: string; count: number;
  note: string; days: ExportDay[]; timeZone: string;
};
/** Groups the visible messages by local day; the sender label is shown when the sender changes within a day. */
export function buildModel(msgs: ExportMessage[], o: ExportOptions): ExportModel {
  const tz = o.timeZone ?? deviceTimeZone(); const da = o.lang === "da"; const now = o.now ?? new Date();
  const sorted = [...msgs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const days: ExportDay[] = [];
  for (const m of sorted) {
    const key = isoDate(m.created_at, tz);
    let d = days[days.length - 1];
    if (!d || d.key !== key) { d = { key, label: dayLabel(m.created_at, o.lang, tz), items: [] }; days.push(d); }
    const sender = senderOf(m, o.me, o.lang); const prev = d.items[d.items.length - 1];
    d.items.push({ m, sender, time: clock(m.created_at, o.lang, tz), showSender: !prev || prev.sender !== sender || prev.m.mine !== m.mine, reply: replyText(m, o.lang), attachment: attachmentText(m, o.lang) });
  }
  const others = [...new Set(o.partners.map((s) => s.trim()).filter(Boolean))];
  if (!others.length) for (const m of sorted) if (!m.mine && m.sender_name && !others.includes(m.sender_name)) others.push(m.sender_name);
  return {
    lang: o.lang, timeZone: tz, title: da ? "Eksporteret samtale" : "Exported conversation",
    partners: others.join(", ") || "–", period: period(sorted, o.lang, tz), exportedBy: o.me || "–",
    exportedAt: `${longDate(now, o.lang, tz)} ${da ? "kl." : "at"} ${clock(now, o.lang, tz)}`, count: sorted.length,
    note: da ? "Indeholder kun beskeder, du selv har adgang til. Testmiljø – opdigtede beskeder." : "Contains only messages you have access to. Test environment – made-up messages.",
    days,
  };
}


type PathOp = { op: string; c: number[] };
export interface PdfDoc {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  setFont(name: string, style?: string): unknown; setFontSize(size: number): unknown; getTextWidth(text: string): number;
  text(text: string, x: number, y: number, options?: Record<string, unknown>): unknown;
  setTextColor(color: string): unknown; setFillColor(color: string): unknown; setDrawColor(color: string): unknown; setLineWidth(w: number): unknown;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string): unknown;
  rect(x: number, y: number, w: number, h: number, style?: string): unknown; line(x1: number, y1: number, x2: number, y2: number): unknown;
  circle(x: number, y: number, r: number, style?: string): unknown; path(ops: PathOp[]): unknown; fill(): unknown;
  addPage(): unknown; setPage(n: number): unknown; getNumberOfPages(): number;
}
export type PdfFonts = { text: string; emoji: string | null; emojiMap: Map<number, number> | null };
export const FALLBACK_FONTS: PdfFonts = { text: "helvetica", emoji: null, emojiMap: null };

export const C = {
  teal: "#016C72", mint: "#7CC4B4", dark: "#1D2A2A", muted: "#5B6B6A", border: "#D5DEDC", soft: "#F4F7F6",
  own: "#72D7BB", ownText: "#0E2A24", ownQuote: "#B4EBDB", other: "#EEF2F1", otherQuote: "#DDE5E3", info: "#E8F5F1", white: "#FFFFFF",
};
export const PAGE = { margin: 48, top: 52, bottom: 50, bubbleMax: 0.72 };

// ---------- emoji-aware text runs ----------
export type Seg = { t: string; emoji: boolean };
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u20E3]/u;
const INVISIBLE = /[\uFE0F\uFE0E\u200D\u{1F3FB}-\u{1F3FF}]/u;
/** Splits text into text/emoji runs. Astral emoji are mapped to the PUA glyphs of the bundled emoji font (jsPDF is BMP-only). */
export function segments(s: string, fonts: PdfFonts): Seg[] {
  const out: Seg[] = [];
  for (const ch of s) {
    if (INVISIBLE.test(ch)) continue;
    const cp = ch.codePointAt(0)!; let emoji = false, t = ch;
    if (EMOJI.test(ch) && fonts.emoji) { emoji = true; if (cp > 0xffff) { const p = fonts.emojiMap?.get(cp); t = p ? String.fromCharCode(p) : "\u25A1"; emoji = !!p; } }
    else if (cp > 0xffff) t = "\u25A1"; // unsupported astral char: visible placeholder instead of garbage
    const last = out[out.length - 1];
    if (last && last.emoji === emoji) last.t += t; else out.push({ t, emoji });
  }
  return out;
}
/** Expands the PUA mapping file ([start, count] runs, ascending) to code point → PUA. */
export function emojiMapFrom(runs: [number, number][]): Map<number, number> {
  const m = new Map<number, number>(); let pua = 0xe000;
  for (const [start, n] of runs) for (let i = 0; i < n; i++) m.set(start + i, pua++);
  return m;
}

type Style = { size: number; bold?: boolean; color: string };
function use(doc: PdfDoc, fonts: PdfFonts, emoji: boolean, st: Style) {
  if (emoji && fonts.emoji) doc.setFont(fonts.emoji, "normal"); else doc.setFont(fonts.text, st.bold ? "bold" : "normal");
  doc.setFontSize(st.size);
}
export function width(doc: PdfDoc, fonts: PdfFonts, segs: Seg[], st: Style): number {
  let w = 0; for (const s of segs) { use(doc, fonts, s.emoji, st); w += doc.getTextWidth(s.t); } return w;
}
function draw(doc: PdfDoc, fonts: PdfFonts, segs: Seg[], x: number, y: number, st: Style) {
  doc.setTextColor(st.color);
  for (const s of segs) { use(doc, fonts, s.emoji, st); doc.text(s.t, x, y); x += doc.getTextWidth(s.t); }
}
/** Greedy word wrap over mixed runs; honours explicit newlines and breaks over-long words. */
export function wrap(doc: PdfDoc, fonts: PdfFonts, text: string, maxW: number, st: Style): Seg[][] {
  const lines: Seg[][] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line: Seg[] = [];
    const add = (segs: Seg[]) => { for (const s of segs) { const l = line[line.length - 1]; if (l && l.emoji === s.emoji) l.t += s.t; else line.push({ ...s }); } };
    const words = para.split(/( +)/).filter((w) => w !== "");
    for (const word of words) {
      const ws = segments(word, fonts); if (!ws.length) continue;
      const isSpace = /^ +$/.test(word);
      if (width(doc, fonts, [...line, ...ws], st) <= maxW) { add(ws); continue; }
      if (isSpace) { lines.push(line); line = []; continue; }
      if (line.length) { lines.push(trimEnd(line)); line = []; }
      if (width(doc, fonts, ws, st) <= maxW) { add(ws); continue; }
      for (const s of ws) for (const ch of s.t) { // hard-break a long word
        const c = [{ t: ch, emoji: s.emoji }];
        if (line.length && width(doc, fonts, [...line, ...c], st) > maxW) { lines.push(line); line = []; }
        add(c);
      }
    }
    lines.push(trimEnd(line));
  }
  return lines;
}
function trimEnd(line: Seg[]): Seg[] { const l = line.map((s) => ({ ...s })); while (l.length && !l[l.length - 1].emoji && !(l[l.length - 1].t = l[l.length - 1].t.replace(/ +$/, ""))) l.pop(); return l; }

// ---------- ROLFF logo (vector copy of assets/logo/rolff-logo.svg) ----------
function arc(ops: PathOp[], cx: number, cy: number, r: number, a0: number, a1: number) {
  const n = Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)), d = (a1 - a0) / n, k = (4 / 3) * Math.tan(d / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * d, e = s + d;
    ops.push({ op: "c", c: [cx + r * (Math.cos(s) - k * Math.sin(s)), cy + r * (Math.sin(s) + k * Math.cos(s)), cx + r * (Math.cos(e) + k * Math.sin(e)), cy + r * (Math.sin(e) - k * Math.cos(e)), cx + r * Math.cos(e), cy + r * Math.sin(e)] });
  }
}
export function drawLogo(doc: PdfDoc, x: number, y: number, size: number) {
  const s = size / 640, P = (px: number, py: number) => [x + px * s, y + py * s];
  const D = Math.PI / 180;
  const sc = (ops: PathOp[]) => ops.map((o) => ({ op: o.op, c: o.c.map((v, i) => (i % 2 ? y + v * s : x + v * s)) }));
  doc.setFillColor(C.teal); doc.roundedRect(x, y, size, size, 142 * s, 142 * s, "F");
  const b: PathOp[] = [{ op: "m", c: [289, 140] }, { op: "l", c: [350, 140] }];
  arc(b, 350, 295, 155, -90 * D, 90 * D);
  b.push({ op: "l", c: [278, 450] }, { op: "c", c: [262, 450, 250, 456, 236, 463] }, { op: "c", c: [206, 479, 180, 493, 158, 498] },
    { op: "c", c: [146, 501, 136, 494, 141, 484] }, { op: "c", c: [153, 462, 165, 440, 165, 412] }, { op: "c", c: [165, 400, 160, 390, 154, 380] },
    { op: "c", c: [142, 356, 134, 328, 134, 295] });
  arc(b, 289, 295, 155, 180 * D, 270 * D); b.push({ op: "h", c: [] });
  doc.setFillColor(C.white); doc.path(sc(b)); doc.fill();
  doc.setFillColor(C.teal); const [rx, ry] = P(245, 212); doc.roundedRect(rx, ry, 74 * s, 182 * s, 34 * s, 34 * s, "F");
  const r: PathOp[] = [{ op: "m", c: [300, 240] }, { op: "c", c: [322, 220, 344, 211, 368, 211] }, { op: "l", c: [373, 211] }, { op: "c", c: [396, 211, 410, 226, 410, 248] },
    { op: "c", c: [410, 266, 400, 280, 380, 280] }, { op: "l", c: [352, 280] }, { op: "c", c: [332, 280, 319, 295, 319, 318] }, { op: "l", c: [319, 330] },
    { op: "l", c: [290, 330] }, { op: "l", c: [290, 250] }, { op: "h", c: [] }];
  doc.path(sc(r)); doc.fill();
}

// ---------- page layout ----------
const T = { body: { size: 10.5, color: C.dark }, own: { size: 10.5, color: C.ownText }, label: { size: 8, bold: true, color: C.muted },
  time: { size: 7.5, color: C.muted }, quote: { size: 8.5, color: C.muted }, att: { size: 9, bold: true, color: C.dark } } satisfies Record<string, Style>;
const LH = 14, PADX = 10, PADY = 8;

type Block = { h: number; draw: (y: number) => void };
export type RenderResult = { pages: number };

export function renderConversationPdf(doc: PdfDoc, model: ExportModel, fonts: PdfFonts = FALLBACK_FONTS): RenderResult {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = PAGE.margin, CW = W - 2 * M;
  const da = model.lang === "da"; const bottom = H - PAGE.bottom - 12;
  let y = 0;
  const firstPage = () => {
    drawLogo(doc, M, 44, 46);
    draw(doc, fonts, segments("ROLFF", fonts), M + 58, 58, { size: 9, bold: true, color: C.teal });
    draw(doc, fonts, segments(model.title, fonts), M + 58, 82, { size: 21, bold: true, color: C.dark });
    y = 112;
    // meta card
    const rows: [string, string][] = [
      [da ? "Samtale med" : "Conversation with", model.partners], [da ? "Periode" : "Period", model.period],
      [da ? "Antal beskeder" : "Messages", String(model.count)], [da ? "Eksporteret af" : "Exported by", model.exportedBy],
      [da ? "Eksporteret" : "Exported", model.exportedAt], [da ? "Tidszone" : "Time zone", model.timeZone],
    ];
    const LW = 104, vw = CW - 2 * 14 - LW;
    const wrapped = rows.map(([k, v]) => [k, wrap(doc, fonts, v, vw, { size: 10, color: C.dark })] as const);
    const h = 14 + wrapped.reduce((s, [, l]) => s + l.length * 13 + 5, 0) + 8;
    doc.setFillColor(C.soft); doc.setDrawColor(C.border); doc.setLineWidth(0.6); doc.roundedRect(M, y, CW, h, 8, 8, "FD");
    doc.setFillColor(C.mint); doc.rect(M, y + 10, 3, h - 20, "F");
    let ry = y + 14 + 9;
    for (const [k, lines] of wrapped) {
      draw(doc, fonts, segments(k.toLocaleUpperCase(), fonts), M + 14, ry, { size: 7.5, bold: true, color: C.muted });
      lines.forEach((l, i) => draw(doc, fonts, l, M + 14 + LW, ry + i * 13, { size: 10, bold: k === rows[0][0], color: C.dark }));
      ry += lines.length * 13 + 5;
    }
    y += h + 10;
    // privacy / test note
    const nl = wrap(doc, fonts, model.note, CW - 44, { size: 8.5, color: C.muted }); const nh = 12 + nl.length * 11;
    doc.setFillColor(C.info); doc.roundedRect(M, y, CW, nh, 6, 6, "F");
    doc.setDrawColor(C.teal); doc.setLineWidth(0.8); doc.circle(M + 15, y + nh / 2, 5.5, "S");
    draw(doc, fonts, segments("i", fonts), M + 13.6, y + nh / 2 + 2.6, { size: 7.5, bold: true, color: C.teal });
    nl.forEach((l, i) => draw(doc, fonts, l, M + 30, y + 15 + i * 11 - 1, { size: 8.5, color: C.muted }));
    y += nh + 18;
  };
  const runningHeader = () => {
    drawLogo(doc, M, 22, 16);
    const label = `${model.title} · ${model.partners}`;
    const l = wrap(doc, fonts, label, CW - 24, { size: 8, color: C.muted })[0] ?? [];
    draw(doc, fonts, l, M + 22, 33.5, { size: 8, color: C.muted });
    doc.setDrawColor(C.border); doc.setLineWidth(0.5); doc.line(M, 46, W - M, 46);
    y = PAGE.top + 10;
  };
  const newPage = () => { doc.addPage(); runningHeader(); };
  const ensure = (h: number) => { if (y + h > bottom) newPage(); };

  firstPage();
  if (!model.count) draw(doc, fonts, segments(da ? "Ingen beskeder." : "No messages.", fonts), M, y + 10, T.body);

  for (const day of model.days) {
    const sep: Block = { h: 30, draw: (yy) => {
      const st = { size: 8.5, bold: true, color: C.muted }; const segs = segments(day.label, fonts); const w = width(doc, fonts, segs, st) + 20;
      const cy = yy + 13; doc.setDrawColor(C.border); doc.setLineWidth(0.5);
      doc.line(M, cy, (W - w) / 2 - 6, cy); doc.line((W + w) / 2 + 6, cy, W - M, cy);
      doc.setFillColor(C.soft); doc.roundedRect((W - w) / 2, cy - 9, w, 18, 9, 9, "FD");
      draw(doc, fonts, segs, (W - w) / 2 + 10, cy + 3, st);
    } };
    day.items.forEach((it, i) => {
      const blocks = bubbleBlocks(it);
      const first = i === 0 ? [sep, ...blocks.slice(0, 1)] : blocks.slice(0, 1);
      // keep the day separator + sender label + bubble (or its first chunk) together
      ensure(first.reduce((s, b) => s + b.h, 0));
      if (i === 0) { sep.draw(y); y += sep.h; }
      blocks.forEach((b, j) => { if (j > 0) ensure(b.h); b.draw(y); y += b.h; });
    });
  }

  function bubbleBlocks(it: ExportItem): Block[] {
    const own = it.m.mine; const maxW = CW * PAGE.bubbleMax; const inner = maxW - 2 * PADX; const bodySt = own ? T.own : T.body;
    const quote = it.reply ? wrap(doc, fonts, it.reply, inner - 10, T.quote).slice(0, 4) : [];
    if (it.reply && wrap(doc, fonts, it.reply, inner - 10, T.quote).length > 4) quote[3] = [...quote[3], { t: "…", emoji: false }];
    const att = it.attachment ? wrap(doc, fonts, `${da ? "Vedhæftning" : "Attachment"}: ${it.attachment}`, inner, T.att) : [];
    const alt = it.m.att_alt ? wrap(doc, fonts, `${da ? "Billedbeskrivelse" : "Description"}: ${it.m.att_alt}`, inner, T.quote) : [];
    const attNote = it.attachment ? wrap(doc, fonts, da ? "Selve filen er ikke med i PDF'en." : "The file itself is not included in the PDF.", inner, T.quote) : [];
    const body = it.m.body ? wrap(doc, fonts, it.m.body, inner, bodySt) : [];
    const timeSegs = segments(it.time, fonts); const tw = width(doc, fonts, timeSegs, T.time);
    const lw = (ls: Seg[][], st: Style, extra = 0) => Math.max(0, ...ls.map((l) => width(doc, fonts, l, st) + extra));
    const bw = Math.min(maxW, Math.max(lw(body, bodySt), lw(quote, T.quote, 10), lw(att, T.att), lw(alt, T.quote), lw(attNote, T.quote), tw, 24) + 2 * PADX);
    const bx = own ? W - M - bw : M;
    const out: Block[] = [];
    // header rows (quote/attachment) count as lines of the first chunk
    type Row = { h: number; draw: (y: number) => void };
    const rows: Row[] = [];
    if (quote.length) {
      const qh = quote.length * 11 + 8;
      rows.push({ h: qh + 6, draw: (yy) => { doc.setFillColor(own ? C.ownQuote : C.otherQuote); doc.roundedRect(bx + PADX, yy, bw - 2 * PADX, qh, 4, 4, "F");
        doc.setFillColor(C.teal); doc.rect(bx + PADX, yy, 2.2, qh, "F"); quote.forEach((l, k) => draw(doc, fonts, l, bx + PADX + 8, yy + 12 + k * 11 - 1, { ...T.quote, color: own ? C.ownText : C.muted })); } });
    }
    for (const l of att) rows.push({ h: 13, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 10, { ...T.att, bold: true, color: own ? C.ownText : C.dark }) });
    for (const l of alt) rows.push({ h: 11, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 9, { ...T.quote, color: own ? C.ownText : C.muted }) });
    for (const l of attNote) rows.push({ h: 11, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 9, { ...T.quote, color: own ? C.ownText : C.muted }) });
    if (att.length && body.length) rows.push({ h: 4, draw: () => {} });
    for (const l of body) rows.push({ h: LH, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 10.5, bodySt) });
    const timeH = 11;
    // chunk rows so a bubble never exceeds one page; normal messages are one chunk
    const labelH = it.showSender ? 14 : 0; const maxChunk = bottom - (PAGE.top + 10) - labelH - 2 * PADY - timeH - 8;
    const chunks: Row[][] = [[]]; let acc = 0;
    for (const r of rows) { if (acc + r.h > maxChunk && chunks[chunks.length - 1].length) { chunks.push([]); acc = 0; } chunks[chunks.length - 1].push(r); acc += r.h; }
    chunks.forEach((rs, ci) => {
      const last = ci === chunks.length - 1; const lab = ci === 0 ? labelH : 0;
      const ch = rs.reduce((s, r) => s + r.h, 0) + 2 * PADY + (last ? timeH : 0);
      out.push({ h: lab + ch + (last ? 7 : 4), draw: (yy) => {
        if (lab) {
          const st = T.label; const segs = wrap(doc, fonts, it.sender, maxW, st)[0] ?? [];
          const w = width(doc, fonts, segs, st); draw(doc, fonts, segs, own ? W - M - w - 2 : M + 2, yy + 9, st);
        }
        const by = yy + lab;
        if (own) { doc.setFillColor(C.own); doc.roundedRect(bx, by, bw, ch, 9, 9, "F"); }
        else { doc.setFillColor(C.other); doc.setDrawColor(C.border); doc.setLineWidth(0.5); doc.roundedRect(bx, by, bw, ch, 9, 9, "FD"); }
        let ry = by + PADY; for (const r of rs) { r.draw(ry); ry += r.h; }
        if (last) draw(doc, fonts, timeSegs, bx + bw - PADX - tw, by + ch - PADY + 1, { ...T.time, color: own ? C.ownText : C.muted });
        else draw(doc, fonts, segments(da ? "fortsættes …" : "continued …", fonts), bx + PADX, by + ch - 3, T.time);
      } });
    });
    return out;
  }

  // footer on every page, once the total is known
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); const fy = H - PAGE.bottom + 18;
    doc.setDrawColor(C.border); doc.setLineWidth(0.5); doc.line(M, fy - 12, W - M, fy - 12);
    const left = segments(da ? "Eksporteret fra ROLFF" : "Exported from ROLFF", fonts); const st = { size: 8, color: C.muted };
    draw(doc, fonts, left, M, fy, st);
    const right = segments(da ? `Side ${p} af ${n}` : `Page ${p} of ${n}`, fonts); draw(doc, fonts, right, W - M - width(doc, fonts, right, st), fy, st);
  }
  return { pages: n };
}
/** True when any visible text needs the (larger) emoji font. */
export const needsEmojiFont = (texts: (string | null | undefined)[]) => texts.some((t) => !!t && EMOJI.test(t));
