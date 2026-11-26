// Rule-based pre-checks that run in send-message BEFORE any LLM call. Pure module (no deps).
//
// Blocked-word matching (documented choice):
// - Case-insensitive and diacritic-insensitive (é→e, å→a, ü→u; æ/ø are kept as letters).
// - Whole-word match on word boundaries: "pis" matches "pis" and "PIS!" but NOT "pispot".
// - Multi-word expressions match as a contiguous word sequence ("pis hoved" ≠ "pishoved").
// - Opt-in stem match: a trailing "*" ("pis*") also matches words starting with the stem ("pispot").
export type RuleCode = "blocked_word" | "emoji" | "emoticon" | "caps" | "repeat";
export interface RuleHit { rule: RuleCode; word?: string }

export const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();

interface Tok { n: string; start: number; end: number }
function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ n: fold(m[0]), start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** Returns the exact text from the message that matched a blocked entry, or null. */
export function findBlockedWord(msg: string, blocked: string[]): string | null {
  const toks = tokens(msg);
  for (const raw of blocked) {
    const stem = raw.trim().endsWith("*");
    const parts = tokens(raw.replace(/\*+\s*$/, "")).map((t) => t.n);
    if (parts.length === 0) continue;
    for (let i = 0; i + parts.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        const t = toks[i + j].n, last = j === parts.length - 1;
        if (!(t === parts[j] || (stem && last && t.startsWith(parts[j])))) { ok = false; break; }
      }
      if (ok) return msg.slice(toks[i].start, toks[i + parts.length - 1].end);
    }
  }
  return null;
}

const NOT_EMOJI = new Set(["©", "®", "™", "#", "*", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
export function hasEmoji(msg: string): boolean {
  for (const ch of msg) {
    if (NOT_EMOJI.has(ch)) continue;
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}/u.test(ch)) return true;
  }
  return false;
}

/** "Shouting": at least 8 cased letters and ≥70 % of them uppercase. Short acronyms (OK, PDF) pass. */
export function isShouting(msg: string): boolean {
  const letters = [...msg].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length < 8) return false;
  const up = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return up / letters.length >= 0.7;
}

const canon = (s: string) => tokens(s).map((t) => t.n).join(" ");
/** Same text (ignoring case, accents, punctuation, spacing) as one of the sender's recent messages. */
export function isRepeat(msg: string, recentOwn: string[]): boolean {
  const c = canon(msg);
  return c.length > 0 && recentOwn.some((o) => canon(o) === c);
}

/** Boundary: start/end, whitespace, or punctuation — not a letter or digit. */
function isBoundary(msg: string, index: number, side: "before" | "after"): boolean {
  const ch = side === "before" ? (index <= 0 ? "" : msg[index - 1]) : (index >= msg.length ? "" : msg[index]);
  if (!ch) return true;
  return !/[\p{L}\p{N}]/u.test(ch);
}

const KAOMJI = [
  "¯\\_(ツ)_/¯", "¯\\(ツ)/¯", "\\_(ツ)_/",
  "(^__^)", "(^_^)", "(^o^)", "(^O^)", "(^-^)", "(^_−)", "(^_-)",
  "(>_<)", "(._.)", "(-_-)", "(-.-)", "(*_*)",
  "(o_O)", "(O_o)", "(O_O)", "(o_o)", "(0_0)",
  "(T_T)", "(T.T)", "(;_;)", "(;-;)", "(ToT)",
  "TT_TT", "T_T", "T.T", "T-T", ";_;",
  "o_O", "O_o", "O_O", "o_o", "0_0", "o.O", "O.o",
  "^__^", "^_^", "^-^", "^o^", "^^",
  "-_-", "-.-",
  ">_<",
  ">:-(", ">:(", ">:-)", ">:)",
];

const NOSES = new Set(["-", "~", "^", "o", "O", "\u2010", "\u2011", "\u2013"]);
const SINGLE_MOUTHS = new Set(["P", "p", "/", "\\", "|", "O", "o", "*", "3", "v", "V", ">", "<", "]", "["]);

function isTimeOrRatio(msg: string, colon: number): boolean {
  return /\d$/u.test(msg.slice(0, colon)) && /^\d/u.test(msg.slice(colon + 1));
}

/** :/ in a URL or path (http://, C:/Users, file://). */
function isUrlOrPath(msg: string, colon: number): boolean {
  const after = msg.slice(colon + 1);
  if (after.startsWith("//")) return true;
  // C:/Users — not a lone ":/" at the end of a sentence.
  if (after.startsWith("/") && /^[A-Za-z0-9._~-]/.test(after.slice(1))) return true;
  const before = msg.slice(0, colon).toLowerCase();
  return /(?:^|[^a-z0-9])(?:https?|ftp|file|mailto|ws|wss)$/.test(before);
}

/** "8) Gå i skole" at the start of a line is a list, not sunglasses. */
function isLineStartList(msg: string, start: number, end: number): boolean {
  const token = msg.slice(start, end);
  if (!/^[8B]-?\)$/.test(token)) return false;
  if (!/(^|\n)[ \t]*$/.test(msg.slice(0, start))) return false;
  return /^\s+\S/.test(msg.slice(end));
}

function takeMouths(msg: string, start: number, repeatable: string): number {
  if (start >= msg.length) return -1;
  const raw = msg[start];
  const mouth = raw === "\uFF09" ? ")" : raw === "\uFF08" ? "(" : raw;
  if (mouth !== repeatable) return -1;
  let n = start + 1;
  while (n < msg.length) {
    const c = msg[n] === "\uFF09" ? ")" : msg[n] === "\uFF08" ? "(" : msg[n];
    if (c !== mouth) break;
    n++;
  }
  return n;
}

function mouthEnd(msg: string, eyes: number, mouthStart: number): number {
  if (mouthStart >= msg.length) return -1;
  const raw = msg[mouthStart];
  const mouth = raw === "\uFF09" ? ")" : raw === "\uFF08" ? "(" : raw;
  if (mouth === ")" || mouth === "(" || mouth === "D") return takeMouths(msg, mouthStart, mouth);
  if (SINGLE_MOUTHS.has(mouth)) {
    if ((mouth === "/" || mouth === "\\") && isUrlOrPath(msg, eyes)) return -1;
    return mouthStart + 1;
  }
  return -1;
}

function matchWestern(msg: string, i: number): number {
  const eyes = msg[i];
  if (eyes !== ":" && eyes !== ";" && eyes !== "=" && eyes !== "\uFF1A" && eyes !== "\uFF1B") return -1;
  if (isTimeOrRatio(msg, i)) return -1;
  let k = i + 1;
  if (msg[k] === "'") k++;
  const afterNose = NOSES.has(msg[k] ?? "") ? k + 1 : k;
  const longer = mouthEnd(msg, i, afterNose);
  if (longer > afterNose && isBoundary(msg, longer, "after")) return longer;
  if (afterNose !== k) {
    const shorter = mouthEnd(msg, i, k);
    if (shorter > k && isBoundary(msg, shorter, "after")) return shorter;
  }
  return -1;
}

function matchSunglasses(msg: string, i: number): number {
  if (msg[i] !== "8" && msg[i] !== "B") return -1;
  let k = i + 1;
  if (NOSES.has(msg[k] ?? "")) k++;
  if (msg[k] !== ")" && msg[k] !== "D") return -1;
  const end = k + 1;
  if (isLineStartList(msg, i, end)) return -1;
  return end;
}

function matchXD(msg: string, i: number): number {
  if (msg[i] !== "x" && msg[i] !== "X") return -1;
  if (msg[i + 1] !== "D" && msg[i + 1] !== "d") return -1;
  return i + 2;
}

function matchHeart(msg: string, i: number): number {
  if (msg[i] !== "<") return -1;
  if (msg.startsWith("</3", i)) return /^\d|^\.\d/.test(msg.slice(i + 3)) ? -1 : i + 3;
  if (msg.startsWith("<3", i)) return /^\d|^\.\d/.test(msg.slice(i + 2)) ? -1 : i + 2;
  return -1;
}

function matchReversed(msg: string, i: number): number {
  const open = msg[i] === "(" || msg[i] === "\uFF08";
  const close = msg[i] === ")" || msg[i] === "\uFF09";
  if (!open && !close) return -1;
  const kind = open ? "(" : ")";
  let k = i + 1;
  while (k < msg.length) {
    const c = msg[k] === "\uFF09" ? ")" : msg[k] === "\uFF08" ? "(" : msg[k];
    if (c !== kind) break;
    k++;
  }
  if (NOSES.has(msg[k] ?? "")) k++;
  if (msg[k] !== ":" && msg[k] !== "\uFF1A") return -1;
  return k + 1;
}

/**
 * First text emoticon in the message (the exact characters), or null.
 * Deterministic, no model. Known faces are blocked; times, scores, URLs,
 * list markers and ordinary punctuation in sentences are left alone.
 */
export function findEmoticon(msg: string): string | null {
  if (!msg) return null;
  let start = -1, end = -1;
  const consider = (s: number, e: number) => {
    if (s < 0 || e <= s) return;
    if (!isBoundary(msg, s, "before") || !isBoundary(msg, e, "after")) return;
    if (start < 0 || s < start || (s === start && e > end)) { start = s; end = e; }
  };
  for (const face of KAOMJI) {
    let from = 0;
    while (from <= msg.length - face.length) {
      const at = msg.indexOf(face, from);
      if (at < 0) break;
      consider(at, at + face.length);
      from = at + 1;
    }
  }
  for (let i = 0; i < msg.length; i++) {
    if (!isBoundary(msg, i, "before")) continue;
    for (const end of [matchHeart(msg, i), matchSunglasses(msg, i), matchXD(msg, i), matchReversed(msg, i), matchWestern(msg, i)]) {
      if (end > i) consider(i, end);
    }
  }
  return start >= 0 ? msg.slice(start, end) : null;
}

export const hasEmoticon = (msg: string) => findEmoticon(msg) !== null;


export function checkRules(msg: string, othersBlocked: string[], recentOwn: string[]): RuleHit | null {
  const w = findBlockedWord(msg, othersBlocked);
  if (w) return { rule: "blocked_word", word: w };
  if (hasEmoji(msg)) return { rule: "emoji" };
  const em = findEmoticon(msg);
  if (em) return { rule: "emoticon", word: em };
  if (isShouting(msg)) return { rule: "caps" };
  if (isRepeat(msg, recentOwn)) return { rule: "repeat" };
  return null;
}
