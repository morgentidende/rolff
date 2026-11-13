import type { ReceiveWindow } from "./receiveTimezone";
/** Pure checks for the Modtagetider editor. The server accepts overnight windows (end before start,
 *  e.g. 22:00–02:00 continues into the next day) and rejects start = end; overlaps are stored as-is,
 *  so the editor points them out and offers to merge them before saving. */
const WEEK = 7 * 1440;
type Span = { s: number; e: number; i: number };
const span = (w: ReceiveWindow, i: number): Span => { const s = (w.weekday - 1) * 1440 + w.start_minute; return { s, e: s + (w.end_minute > w.start_minute ? w.end_minute - w.start_minute : w.end_minute + 1440 - w.start_minute), i }; };
export type WindowIssue = { kind: "same"; index: number; weekday: number } | { kind: "overlap"; indexes: [number, number]; weekday: number };
export function windowIssues(ws: ReceiveWindow[]): WindowIssue[] {
  const out: WindowIssue[] = [];
  ws.forEach((w, i) => { if (w.start_minute === w.end_minute) out.push({ kind: "same", index: i, weekday: w.weekday }); });
  const sp = ws.map(span).filter(x => x.e > x.s && ws[x.i].start_minute !== ws[x.i].end_minute);
  for (let a = 0; a < sp.length; a++) for (let b = a + 1; b < sp.length; b++) {
    const A = sp[a], B = sp[b];
    const hit = (x: Span, y: Span, shift: number) => x.s < y.e + shift && y.s + shift < x.e;
    if (hit(A, B, 0) || hit(A, B, WEEK) || hit(A, B, -WEEK)) out.push({ kind: "overlap", indexes: [A.i, B.i], weekday: ws[Math.max(A.s, B.s) === A.s ? A.i : B.i].weekday });
  }
  return out;
}
/** Merges overlapping windows (same-week spans only). Returns null when a merged span would exceed
 *  24 hours or wrap past Sunday, so the user decides instead. */
export function mergeWindows(ws: ReceiveWindow[]): ReceiveWindow[] | null {
  const sp = ws.filter(w => w.start_minute !== w.end_minute).map(span).sort((a, b) => a.s - b.s || a.e - b.e);
  const merged: { s: number; e: number }[] = [];
  for (const x of sp) { const last = merged[merged.length - 1]; if (last && x.s < last.e) last.e = Math.max(last.e, x.e); else merged.push({ s: x.s, e: x.e }); }
  const out: ReceiveWindow[] = [];
  for (const m of merged) {
    if (m.e - m.s > 1440 || m.e > WEEK) return null;
    const day = Math.floor(m.s / 1440), start = m.s - day * 1440, endAbs = m.e - day * 1440;
    out.push({ weekday: day + 1, start_minute: start, end_minute: endAbs > 1440 ? endAbs - 1440 : endAbs });
  }
  if (out.some(w => w.start_minute === w.end_minute)) return null;
  return out;
}
