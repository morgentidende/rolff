// Rule-based pre-checks that run in send-message BEFORE any LLM call. Pure module (no deps).
//
// Blocked-word matching (documented choice):
// - Case-insensitive and diacritic-insensitive (é→e, å→a, ü→u; æ/ø are kept as letters).
// - Whole-word match on word boundaries: "pis" matches "pis" and "PIS!" but NOT "pispot".
// - Multi-word expressions match as a contiguous word sequence ("pis hoved" ≠ "pishoved").
// - Opt-in stem match: a trailing "*" ("pis*") also matches words starting with the stem ("pispot").
export type RuleCode = "blocked_word" | "emoji" | "caps" | "repeat";
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

export function checkRules(msg: string, othersBlocked: string[], recentOwn: string[]): RuleHit | null {
  const w = findBlockedWord(msg, othersBlocked);
  if (w) return { rule: "blocked_word", word: w };
  if (hasEmoji(msg)) return { rule: "emoji" };
  if (isShouting(msg)) return { rule: "caps" };
  if (isRepeat(msg, recentOwn)) return { rule: "repeat" };
  return null;
}
