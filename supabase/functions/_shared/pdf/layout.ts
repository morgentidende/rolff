// Court-oriented conversation PDF (server side). Pure model + layout with jsPDF-compatible calls;
// no imports, so it is unit-testable with a recording fake document. Input is ONLY database rows
// from get_export_messages (never client-supplied content). Nothing here logs message content.
export type ExportMessage = {
  id: string; sender_label: string | null; sender_email: string | null; sender_deleted: boolean; mine: boolean; body: string; created_at: string;
  att_mime?: string | null; att_name?: string | null; att_size?: number | null; att_pages?: number | null; att_sha256?: string | null;
  reply_to_id?: string | null; has_reply?: boolean; reply_visible?: boolean;
};
export type ExportLang = "da" | "en";
export type ExportMeta = {
  exportId: string; verifyCode: string; verifyUrl: string; exporterEmail: string; recipient: string; partners: string[];
  createdAt: string; timeZone: string; periodFrom: string | null; periodTo: string | null;
};

const LOC = "da-DK";
export function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length > 64) return "Europe/Copenhagen";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return "Europe/Copenhagen"; }
}
function parts(d: Date, timeZone: string, o: Intl.DateTimeFormatOptions, loc = LOC) {
  const r: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(loc, { ...o, timeZone }).formatToParts(d)) r[p.type] = p.value;
  return r;
}
export function isoDate(iso: string | Date, timeZone: string): string {
  const p = parts(new Date(iso), timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }, "en"); return `${p.year}-${p.month}-${p.day}`;
}
/** 14.05 in the zone (Danish clock). */
export function clock(iso: string | Date, timeZone: string): string {
  const p = parts(new Date(iso), timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); return `${p.hour}.${p.minute}.${p.second}`;
}
/** 2026-11-06 13:05:09 UTC */
export const utcStamp = (iso: string | Date) => new Date(iso).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
export function longDate(iso: string | Date, timeZone: string): string {
  const p = parts(new Date(iso), timeZone, { day: "numeric", month: "long", year: "numeric" }); return `${p.day}. ${p.month} ${p.year}`;
}
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("da") + s.slice(1);
export function dayLabel(iso: string | Date, timeZone: string): string {
  return `${cap(parts(new Date(iso), timeZone, { weekday: "long" }).weekday)} ${longDate(iso, timeZone)}`;
}
const range = (a: string, b: string, tz: string) => isoDate(a, tz) === isoDate(b, tz) ? longDate(a, tz) : `${longDate(a, tz)} – ${longDate(b, tz)}`;
export const groupCode = (c: string) => c.replace(/(.{4})(?=.)/g, "$1-");
const kb = (n: number) => n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
export function attachmentText(m: ExportMessage): string | null {
  if (!m.att_name && !m.att_mime) return null;
  const kind = m.att_mime === "application/pdf" ? "PDF" : m.att_mime?.startsWith("image/") ? "billede" : (m.att_mime ?? "");
  const extra = [kind, m.att_pages ? `${m.att_pages} ${m.att_pages === 1 ? "side" : "sider"}` : "", m.att_size ? kb(m.att_size) : ""].filter(Boolean).join(", ");
  return `${m.att_name || "Vedhæftning"}${extra ? ` (${extra})` : ""}`;
}

export type ExportItem = { m: ExportMessage; sender: string; senderEmail: string | null; time: string; utc: string; showSender: boolean; reply: string | null; attachment: string | null };
export type ExportDay = { key: string; label: string; items: ExportItem[] };
export type ExportModel = {
  title: string; meta: ExportMeta; partners: string; scope: string; partial: boolean; count: number; exportedAt: string; exportedAtUtc: string;
  notes: string[]; days: ExportDay[];
};
export function buildModel(rows: ExportMessage[], meta: ExportMeta): ExportModel {
  const tz = validTimeZone(meta.timeZone);
  const msgs = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const days: ExportDay[] = [];
  for (const m of msgs) {
    const key = isoDate(m.created_at, tz); let d = days[days.length - 1];
    if (!d || d.key !== key) { d = { key, label: dayLabel(m.created_at, tz), items: [] }; days.push(d); }
    const sender = m.sender_deleted ? "Slettet bruger (kontoen er slettet)" : (m.sender_label || m.sender_email || "Ukendt afsender");
    const prev = d.items[d.items.length - 1];
    let reply: string | null = null;
    if (m.reply_to_id || m.has_reply) {
      const target = m.reply_to_id && m.reply_visible ? byId.get(m.reply_to_id) : undefined;
      if (target) { const c = [...target.body]; reply = `Svar på besked ${target.id}: ${c.length > 160 ? c.slice(0, 160).join("") + "…" : target.body}`; }
      else if (m.reply_to_id && m.reply_visible) reply = `Svar på besked ${m.reply_to_id} (uden for udsnittet)`;
      else reply = "Svar på en besked, der ikke er tilgængelig for dig (slettet eller fra før du kom med).";
    }
    d.items.push({ m, sender, senderEmail: m.sender_deleted ? null : m.sender_email, time: clock(m.created_at, tz), utc: utcStamp(m.created_at),
      showSender: !prev || prev.sender !== sender || prev.m.mine !== m.mine, reply, attachment: attachmentText(m) });
  }
  const partial = !!(meta.periodFrom || meta.periodTo);
  const scope = partial
    ? `Udsnit: ${meta.periodFrom ? longDate(meta.periodFrom, tz) : "start"} – ${meta.periodTo ? longDate(meta.periodTo, tz) : "nu"}`
    : (msgs.length ? `Hele samtalen (${range(msgs[0].created_at, msgs[msgs.length - 1].created_at, tz)})` : "Hele samtalen");
  return {
    title: "Udskrift af samtale", meta: { ...meta, timeZone: tz }, partners: meta.partners.join(", ") || "–", scope, partial, count: msgs.length,
    exportedAt: `${longDate(meta.createdAt, tz)} kl. ${clock(meta.createdAt, tz)}`, exportedAtUtc: utcStamp(meta.createdAt),
    notes: [
      "Indeholder kun beskeder, som eksportøren selv har adgang til i ROLFF: egne beskeder og beskeder leveret til eksportøren, fra eksportøren kom med i samtalen og inden for eksportørens opbevaringsperiode.",
      "Beskeder, der blev stoppet af tonetjekket eller af modtagerens blokeringslister, blev aldrig sendt og er derfor ikke med. Vedhæftede filer er ikke med; de er angivet med navn og SHA-256.",
      "Tidspunkter er serverens tidsstempler, vist i " + tz + " og i UTC.",
    ],
    days,
  };
}

/** Short scope line for e-mails, in the recipient's app language. The PDF itself stays Danish. */
export function scopeInLang(model: ExportModel, lang: ExportLang): string {
  const tz = validTimeZone(model.meta.timeZone);
  const loc = lang === "en" ? "en-GB" : "da-DK";
  const ld = (iso: string) => {
    const p = parts(new Date(iso), tz, { day: "numeric", month: "long", year: "numeric" }, loc);
    return lang === "en" ? `${p.day} ${p.month} ${p.year}` : `${p.day}. ${p.month} ${p.year}`;
  };
  if (model.partial) {
    const a = model.meta.periodFrom ? ld(model.meta.periodFrom) : "start";
    const b = model.meta.periodTo ? ld(model.meta.periodTo) : (lang === "en" ? "now" : "nu");
    return lang === "en" ? `Excerpt: ${a} – ${b}` : `Udsnit: ${a} – ${b}`;
  }
  const first = model.days[0]?.items[0]?.m.created_at;
  const lastDay = model.days[model.days.length - 1];
  const last = lastDay?.items[lastDay.items.length - 1]?.m.created_at;
  if (first && last) {
    const r = ld(first) === ld(last) ? ld(first) : `${ld(first)} – ${ld(last)}`;
    return lang === "en" ? `The whole conversation (${r})` : `Hele samtalen (${r})`;
  }
  return lang === "en" ? "The whole conversation" : "Hele samtalen";
}

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
type PathOp = { op: string; c: number[] };
export type PdfFonts = { text: string; emoji: string | null; emojiMap: Map<number, number> | null };
export const FALLBACK_FONTS: PdfFonts = { text: "helvetica", emoji: null, emojiMap: null };
/** QR matrix provider (isDark) – injected so the layout stays dependency-free. */
export type Qr = { size: number; isDark(r: number, c: number): boolean };

export const C = {
  teal: "#016C72", mint: "#7CC4B4", dark: "#1D2A2A", muted: "#5B6B6A", border: "#D5DEDC", soft: "#F4F7F6",
  own: "#72D7BB", ownText: "#0E2A24", ownQuote: "#B4EBDB", other: "#EEF2F1", otherQuote: "#DDE5E3", info: "#E8F5F1", white: "#FFFFFF", black: "#000000",
};
export const PAGE = { margin: 44, top: 52, bottom: 86, bubbleMax: 0.72 };

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
  meta: { size: 6.8, color: C.muted }, quote: { size: 8.5, color: C.muted }, att: { size: 9, bold: true, color: C.dark }, hash: { size: 7, color: C.muted } } satisfies Record<string, Style>;
const LH = 14, PADX = 10, PADY = 8;
type Block = { h: number; draw: (y: number) => void };
export type RenderResult = { pages: number };

export function renderExportPdf(doc: PdfDoc, model: ExportModel, fonts: PdfFonts = FALLBACK_FONTS, qr?: Qr): RenderResult {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = PAGE.margin, CW = W - 2 * M;
  const bottom = H - PAGE.bottom; const meta = model.meta; let y = 0;
  const txt = (s: string, x: number, yy: number, st: Style) => draw(doc, fonts, segments(s, fonts), x, yy, st);
  const firstPage = () => {
    drawLogo(doc, M, 40, 46);
    txt("ROLFF", M + 58, 54, { size: 9, bold: true, color: C.teal });
    txt(model.title, M + 58, 78, { size: 21, bold: true, color: C.dark });
    y = 104;
    const rows: [string, string, boolean?][] = [
      ["Samtale med", model.partners, true], [model.partial ? "Udsnit" : "Omfang", model.scope.replace(/^Udsnit: /, ""), model.partial],
      ["Antal beskeder", String(model.count)], ["Eksporteret af", meta.exporterEmail],
      ["Eksporteret", `${model.exportedAt} (${meta.timeZone}) · ${model.exportedAtUtc}`], ["Sendt til", meta.recipient],
      ["Eksport-ID", meta.exportId], ["Verifikationskode", groupCode(meta.verifyCode), true],
    ];
    const LW = 108, vw = CW - 28 - LW;
    const wrapped = rows.map(([k, v, b]) => [k, wrap(doc, fonts, v, vw, { size: 9.5, bold: b, color: C.dark }), b] as const);
    const h = 12 + wrapped.reduce((s, [, l]) => s + l.length * 12.5 + 4.5, 0) + 6;
    doc.setFillColor(C.soft); doc.setDrawColor(C.border); doc.setLineWidth(0.6); doc.roundedRect(M, y, CW, h, 8, 8, "FD");
    doc.setFillColor(C.mint); doc.rect(M, y + 10, 3, h - 20, "F");
    let ry = y + 12 + 9;
    for (const [k, lines, b] of wrapped) {
      txt(k.toLocaleUpperCase("da"), M + 14, ry, { size: 7.2, bold: true, color: C.muted });
      lines.forEach((l, i) => draw(doc, fonts, l, M + 14 + LW, ry + i * 12.5, { size: 9.5, bold: b, color: model.partial && k === "Udsnit" ? C.teal : C.dark }));
      ry += lines.length * 12.5 + 4.5;
    }
    y += h + 8;
    const info = [
      `Ægthed: Filen er digitalt signeret af ROLFF, og dens SHA-256-fingeraftryk er registreret. Kontrollér den på ${meta.verifyUrl.replace(/\?.*$/, "")} ved at vælge PDF-filen (den forlader ikke din enhed) eller indtaste koden. Ændres blot ét tegn, stemmer kontrollen ikke.`,
      ...model.notes,
    ];
    const lines = info.flatMap((p, i) => wrap(doc, fonts, p, CW - 40, { size: 7.8, bold: i === 0, color: C.muted }).map((l) => ({ l, b: i === 0 })));
    const nh = 12 + lines.length * 10;
    doc.setFillColor(C.info); doc.roundedRect(M, y, CW, nh, 6, 6, "F");
    doc.setDrawColor(C.teal); doc.setLineWidth(0.8); doc.circle(M + 14, y + 13, 5.5, "S");
    txt("i", M + 12.6, y + 15.6, { size: 7.5, bold: true, color: C.teal });
    lines.forEach(({ l, b }, i) => draw(doc, fonts, l, M + 28, y + 14 + i * 10, { size: 7.8, bold: b, color: C.muted }));
    y += nh + 16;
  };
  const runningHeader = () => {
    drawLogo(doc, M, 22, 16);
    const l = wrap(doc, fonts, `${model.title} · ${model.partners} · Eksport-ID ${meta.exportId}`, CW - 24, { size: 7.5, color: C.muted })[0] ?? [];
    draw(doc, fonts, l, M + 22, 33.5, { size: 7.5, color: C.muted });
    doc.setDrawColor(C.border); doc.setLineWidth(0.5); doc.line(M, 46, W - M, 46);
    y = PAGE.top + 10;
  };
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); runningHeader(); } };

  firstPage();
  if (!model.count) txt("Ingen beskeder i det valgte omfang.", M, y + 10, T.body);

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
      ensure((i === 0 ? sep.h : 0) + blocks[0].h);
      if (i === 0) { sep.draw(y); y += sep.h; }
      blocks.forEach((b, j) => { if (j > 0) ensure(b.h); b.draw(y); y += b.h; });
    });
  }

  function bubbleBlocks(it: ExportItem): Block[] {
    const own = it.m.mine; const maxW = CW * PAGE.bubbleMax; const inner = maxW - 2 * PADX; const bodySt = own ? T.own : T.body;
    const qAll = it.reply ? wrap(doc, fonts, it.reply, inner - 10, T.quote) : [];
    const quote = qAll.slice(0, 4); if (qAll.length > 4) quote[3] = [...quote[3], { t: "…", emoji: false }];
    const att = it.attachment ? wrap(doc, fonts, `Vedhæftning: ${it.attachment}`, inner, T.att) : [];
    const hash = it.m.att_sha256 ? wrap(doc, fonts, `SHA-256: ${it.m.att_sha256}`, inner, T.hash) : [];
    const attNote = it.attachment ? wrap(doc, fonts, "Selve filen er ikke med i udskriften.", inner, T.quote) : [];
    const body = it.m.body ? wrap(doc, fonts, it.m.body, inner, bodySt) : [];
    const lw = (ls: Seg[][], st: Style, extra = 0) => Math.max(0, ...ls.map((l) => width(doc, fonts, l, st) + extra));
    const bw = Math.min(maxW, Math.max(lw(body, bodySt), lw(quote, T.quote, 10), lw(att, T.att), lw(hash, T.hash), lw(attNote, T.quote), 30) + 2 * PADX);
    const bx = own ? W - M - bw : M;
    const metaLines = wrap(doc, fonts, `${it.time} (${it.utc}) · Besked-ID ${it.m.id}`, CW, T.meta);
    type Row = { h: number; draw: (y: number) => void };
    const rows: Row[] = [];
    const dim = own ? C.ownText : C.muted;
    if (quote.length) {
      const qh = quote.length * 11 + 8;
      rows.push({ h: qh + 6, draw: (yy) => { doc.setFillColor(own ? C.ownQuote : C.otherQuote); doc.roundedRect(bx + PADX, yy, bw - 2 * PADX, qh, 4, 4, "F");
        doc.setFillColor(C.teal); doc.rect(bx + PADX, yy, 2.2, qh, "F"); quote.forEach((l, k) => draw(doc, fonts, l, bx + PADX + 8, yy + 11 + k * 11, { ...T.quote, color: dim })); } });
    }
    for (const l of att) rows.push({ h: 13, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 10, { ...T.att, color: own ? C.ownText : C.dark }) });
    for (const l of hash) rows.push({ h: 9.5, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 7.5, { ...T.hash, color: dim }) });
    for (const l of attNote) rows.push({ h: 11, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 9, { ...T.quote, color: dim }) });
    if (att.length && body.length) rows.push({ h: 4, draw: () => {} });
    for (const l of body) rows.push({ h: LH, draw: (yy) => draw(doc, fonts, l, bx + PADX, yy + 10.5, bodySt) });
    const labelH = it.showSender ? 14 : 0; const metaH = metaLines.length * 9 + 3;
    const maxChunk = bottom - (PAGE.top + 10) - labelH - 2 * PADY - metaH - 8;
    const chunks: Row[][] = [[]]; let acc = 0;
    for (const r of rows) { if (acc + r.h > maxChunk && chunks[chunks.length - 1].length) { chunks.push([]); acc = 0; } chunks[chunks.length - 1].push(r); acc += r.h; }
    return chunks.map((rs, ci) => {
      const last = ci === chunks.length - 1; const lab = ci === 0 ? labelH : 0;
      const ch = rs.reduce((s, r) => s + r.h, 0) + 2 * PADY;
      return { h: lab + ch + (last ? metaH + 6 : 4), draw: (yy: number) => {
        if (lab) {
          const name = it.senderEmail && it.senderEmail !== it.sender ? `${it.sender} · ${it.senderEmail}` : it.sender;
          const segs = wrap(doc, fonts, name, CW, T.label)[0] ?? []; const w = width(doc, fonts, segs, T.label);
          draw(doc, fonts, segs, own ? W - M - w - 2 : M + 2, yy + 9, T.label);
        }
        const by = yy + lab;
        if (own) { doc.setFillColor(C.own); doc.roundedRect(bx, by, bw, ch, 9, 9, "F"); }
        else { doc.setFillColor(C.other); doc.setDrawColor(C.border); doc.setLineWidth(0.5); doc.roundedRect(bx, by, bw, ch, 9, 9, "FD"); }
        let ry = by + PADY; for (const r of rs) { r.draw(ry); ry += r.h; }
        if (last) metaLines.forEach((l, k) => { const w = width(doc, fonts, l, T.meta); draw(doc, fonts, l, own ? W - M - w - 2 : M + 2, by + ch + 9 + k * 9, T.meta); });
        else txt("fortsættes …", bx + PADX, by + ch - 3, T.meta);
      } };
    });
  }

  // footer: verification code + QR on every page, once the total is known
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); const top = H - PAGE.bottom + 14;
    doc.setDrawColor(C.border); doc.setLineWidth(0.5); doc.line(M, top, W - M, top);
    const qs = 46; let tx = M;
    if (qr) { drawQr(doc, qr, M, top + 8, qs); tx = M + qs + 10; }
    const st = { size: 7.5, color: C.muted };
    txt("Tjek udskriftens ægthed", tx, top + 16, { size: 8, bold: true, color: C.dark });
    txt(meta.verifyUrl, tx, top + 27, st);
    txt(`Kode: ${groupCode(meta.verifyCode)}`, tx, top + 38, { size: 8, bold: true, color: C.teal });
    txt(`Eksport-ID ${meta.exportId}`, tx, top + 49, st);
    const right = segments(`Side ${p} af ${n}`, fonts); txt(`Side ${p} af ${n}`, W - M - width(doc, fonts, right, { size: 8, bold: true, color: C.dark }), top + 16, { size: 8, bold: true, color: C.dark });
    const ef = segments("Eksporteret fra ROLFF", fonts); txt("Eksporteret fra ROLFF", W - M - width(doc, fonts, ef, st), top + 27, st);
  }
  return { pages: n };
}
function drawQr(doc: PdfDoc, qr: Qr, x: number, y: number, size: number) {
  const q = 2, n = qr.size + 2 * q, s = size / n;
  doc.setFillColor(C.white); doc.rect(x, y, size, size, "F"); doc.setFillColor(C.black);
  for (let r = 0; r < qr.size; r++) { let c = 0; while (c < qr.size) { if (!qr.isDark(r, c)) { c++; continue; } let e = c; while (e < qr.size && qr.isDark(r, e)) e++; doc.rect(x + (c + q) * s, y + (r + q) * s, (e - c) * s + 0.05, s + 0.05, "F"); c = e; } }
}
/** True when any visible text needs the (larger) emoji font. */
export const needsEmojiFont = (texts: (string | null | undefined)[]) => texts.some((t) => !!t && EMOJI.test(t));
