// Deterministic "house rules" for message text, run BEFORE any model call (and never depends on one):
//  1. Swear words / ugly words (Danish + English), even when not aimed at anyone.
//  2. Exclamation marks.
// Pure module (no deps). Matching is token based (whole words), so innocent words that merely contain the
// same letters ("kortet", "Helsinge", "Scunthorpe", "Dickens", "slut" = Danish "end") are never hit.
// Compounds/variants are covered by explicit stem patterns (lorte-, pisse-, skide-, møg-, -lort ...).
import type { AppLang } from "./moderation.ts";

const norm = (s: string) => s.normalize("NFKC").toLowerCase();
/** Collapse letter runs: "fuuuck" -> "fuck" (>=3 -> 1) and "pissss" -> "piss" (>=3 -> 2). */
const collapse = (s: string, keep: number) => s.replace(/(\p{L})\1{2,}/gu, (_m, c: string) => c.repeat(keep));

// Whole-token patterns (tested against the lowercased token and its repeat-collapsed variants).
const WORD_PATTERNS: RegExp[] = [
  // Danish
  /^(\p{L}+)?lort(e|en|et|ene|er)?$/u,                 // lort, lorte, lortet, lortebil, hestelort
  /^lort\p{L}*$/u,                                     // lortearbejde, lortefilm
  /^pis$/u, /^pisse\p{L}*$/u, /^piss(ed|ing|er)?$/u,   // pis, pisse, pisser, pissed, pisseirriteret
  /^skide\p{L}*$/u,                                    // skide, skideflot, skiderik
  /^helvede\p{L}*$/u,                                  // helvede, helvedes
  /^fandens$/u, /^fanden$/u, /^fandeme$/u, /^fandme$/u, /^satans$/u,
  /^møg(?!spreder|dynge|fork|kælder|kran)\p{L}*$/u,    // møg, møgsvin, møgunge (not farm words)
  /^røv(en)?$/u, /^røv(hul|banan|dårlig|sur|syg|kedelig|irriteret|fuld|spark|slikker|pulver)\p{L}*$/u, // not røver/røvere
  /^pik(ken)?$/u, /^pik(hoved|fjæs|svin|slikker|slugger)\p{L}*$/u, // pik; not pikant/pikkolo/pikere/pikke (to peck)
  /^kusse\p{L}*$/u,                                    // kusse, kussen, kusser, kussefjæs
  /^sgu$/u, /^pokker\p{L}*$/u,                         // sgu, pokker(s), for pokker
  /^skidt\p{L}*$/u,                                    // skidt, skidtvejr
  /^skod(?!d|sborg)\p{L}*$/u,                          // skod, skodbil (not skodde/skodder = fog/shutters, Skodsborg)
  // Insults / abusive words (approved list)
  /^satan\p{L}*$/u, /^kraftedeme$/u, /^sateme$/u, /^satme$/u,
  /^knald(e|er|et|ene|en|s)?$/u,                       // knald, knalde(r); not knaldrød/knaldhat/knaldert
  /^tøs(en|er|erne|e|edreng\p{L}*|eagtig\p{L}*|ehoved\p{L}*)?$/u, // tøs, tøsedreng; not tøsne (slush)
  /^idiot(isk\p{L}*|er|en|erne)?$/u, /^dumrian\p{L}*$/u, /^tåbe(r|n|rne|lig\p{L}*)?$/u, /^fjols(e|et|ede|er|en|erne)?$/u,
  /^spasser\p{L}*$/u, /^mongol$/u,                     // exactly "mongol"; not Mongoliet/mongolsk/mongoler
  /^evnesvag\p{L}*$/u, /^retarder(et|ede)$/u, /^retarded$/u, /^åndssvag\p{L}*$/u, /^hjernedød(e|t)?$/u,
  /^fedeso\p{L}*$/u, /^tyksak\p{L}*$/u, /^tumpe(r|n|rne)?$/u, /^kvajhoved\p{L}*$/u,
  /^moron(s|ic)?$/u, /^loser(s)?$/u, /^stupid$/u,
  /^pussy$/u, /^pussies$/u, /^cunts?$/u, /^fisse(n|r|rne|hoved|fjæs|hår)?$/u,
  /^hore(n|r|rne|unge|søn|bukke|bukken)?$/u,
  /^knepp\p{L}*$/u,                                    // kneppe, knepper (not "knep" = trick)
  // English / international
  /^\p{L}*fuck\p{L}*$/u,                      // ANY word containing "fuck": fucking, fuckin, fucked, fucker(s), motherfucker, fuckface, fuckup, fucke, fucket, fuckede ...
  /^ph?u(ck|kk)\p{L}*$/u, /^phuck\p{L}*$/u, /^f[xv]ck\p{L}*$/u, /^fuq\p{L}*$/u, // phuck, fxck, fvck, fuq
  /^fuk(k\p{L}*|ing|ed|er|ers|s)?$/u,        // fuk, fukking, fukker (Fukushima passes)
  /^fck(ing|ed|er|ers|s)?$/u, /^mf(er|ers)$/u, /^mofo(s)?$/u,
  /^(bull|horse|dip|ape|bat|chicken|dog|cow|jack|no)?shit(s|ty|ting|ted|e|head|hole|show|storm|face|bag|load)?$/u,
  /^bitch(es|y|ing)?$/u, /^a(ss|rse)holes?$/u, /^(dumb|jack|smart|fat|bad)ass(es)?$/u,
  /^motherfuck\p{L}*$/u, /^bastard(s)?$/u, /^bollocks$/u, /^wanker(s)?$/u, /^twat(s)?$/u, /^dickhead(s)?$/u,
  /^cocksucker(s)?$/u, /^slutty$/u, /^crap(py)?$/u, /^(god)?damn(ed|it)?$/u, /^dammit$/u, /^goddam$/u,
  /^wtf$/u, /^stfu$/u, /^ffs$/u,
];
// Common symbol-obfuscated forms in the raw text: f*ck, f**k, sh*t, b*tch.
const OBFUSCATED = /(?<![\p{L}\p{N}])(?:f[*@#]{1,3}c?k|f[u][*@#]{1,2}k?|f[*@#]ck|ph[u*@#]ck|sh[*@#]t|b[*@#]tch|mf['’]er)\p{L}*(?![\p{L}\p{N}])/giu;
// English "hell" is only blocked in swearing phrases ("the hell", "go to hell", "hell no"), never as a bare word.
const HELL_BEFORE = new Set(["what", "the", "to", "bloody", "holy", "like", "as", "in", "a", "go", "straight"]);
const HELL_AFTER = new Set(["no", "yes", "yeah", "of"]);

const MONGOL_HISTORY = new Set(["empire", "rige", "riget", "hær", "hæren", "imperiet", "imperium", "khan", "invasion", "invasionen"]);

function tokenHit(raw: string): boolean {
  const t = norm(raw);
  for (const v of new Set([t, collapse(t, 2), collapse(t, 1)])) if (WORD_PATTERNS.some((re) => re.test(v))) return true;
  return false;
}

/** Exact swear words found in the message (as written, in order, de-duplicated; max 5). */
export function findProfanity(text: string): string[] {
  const out: string[] = [];
  const toks = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]);
  for (let i = 0; i < toks.length; i++) {
    const t = norm(toks[i]);
    const hell = t === "hell" && ((i > 0 && HELL_BEFORE.has(norm(toks[i - 1]))) || (i + 1 < toks.length && HELL_AFTER.has(norm(toks[i + 1]))));
    const mongolHistory = t === "mongol" && i + 1 < toks.length && MONGOL_HISTORY.has(norm(toks[i + 1]));
    // "dick" only as a lowercase standalone word, so the name Dick / Dickens never match.
    if (hell || toks[i] === "dick" || (!mongolHistory && tokenHit(toks[i]))) out.push(toks[i]);
  }
  for (const m of text.matchAll(OBFUSCATED)) out.push(m[0]);
  return [...new Set(out)].slice(0, 5);
}

const EXCL = "[!！‼⁉]";
const RUN = new RegExp(`[?？]*${EXCL}[!！‼⁉?？]*`, "gu");
/** Every run of exclamation marks as written ("!", "!!", "?!"), de-duplicated; max 5. */
export function findExclamations(text: string): string[] {
  return [...new Set([...text.matchAll(RUN)].map((m) => m[0]))].slice(0, 5);
}

/** Same text with exclamation marks replaced: "?!" -> "?", otherwise a period. "" when nothing meaningful is left. */
export function fixExclamations(text: string): string {
  const out = text.replace(RUN, (run, off: number, whole: string) => {
    const next = whole[off + run.length] ?? "";
    if (/[?？]/.test(run)) return "?";
    if (next === "" || /[.?？]/.test(next)) return next === "" ? "." : "";
    return /\p{L}/u.test(next) ? ". " : ".";
  }).replace(/\.{2,}/g, ".").trim();
  return /[\p{L}\p{N}]/u.test(out) && out !== text.trim() ? out : "";
}

export type HouseKind = "profanity" | "exclamation" | "both";
export interface HouseHit { kind: HouseKind; spans: string[]; profanity: string[]; exclamations: string[] }
export function houseCheck(text: string, opts: { exclamations?: boolean } = {}): HouseHit | null {
  const profanity = findProfanity(text);
  const exclamations = opts.exclamations === false ? [] : findExclamations(text);
  if (!profanity.length && !exclamations.length) return null;
  const kind: HouseKind = profanity.length && exclamations.length ? "both" : profanity.length ? "profanity" : "exclamation";
  return { kind, spans: [...profanity, ...exclamations].slice(0, 5), profanity, exclamations };
}

/** Sender-facing texts: one short line (shown in full, no "Mere"). User-facing: "Rolff" only, never a pronoun, no model name. */
export const HOUSE_EXPLANATION: Record<HouseKind, Record<AppLang, string>> = {
  profanity: {
    da: "Rolff lader ikke bandeord passere.",
    en: "Rolff doesn't let swear words through.",
  },
  exclamation: {
    da: "Rolff lader ikke udråbstegn passere.",
    en: "Rolff doesn't let exclamation marks through.",
  },
  both: {
    da: "Rolff lader ikke bandeord og udråbstegn passere.",
    en: "Rolff doesn't let swear words or exclamation marks through.",
  },
};

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
/** Danish idioms where the swear word is part of a fixed phrase: remove the whole phrase ("for helvede", "ad helvede til"). */
const DA_IDIOM = /^(helvede|helvedes|pokker|pokkers)$/u;

/** Deterministic fallback rewrite for swear-word hits: the flagged word(s) removed, spaces/commas tidied
 *  ("Sikke noget lort at fyre af" -> "Sikke noget at fyre af"). Exclamation marks (if any) become periods.
 *  Returns "" (= no suggestion) unless the result still has at least 2 words and passes the house rules again. */
export function houseFallbackSuggestion(text: string, hit: HouseHit | null = houseCheck(text)): string {
  if (!hit || !hit.profanity.length) return "";
  let out = text;
  for (const span of hit.profanity) {
    const w = norm(span), core = `(?<![\\p{L}\\p{N}])${escRe(span)}(?![\\p{L}\\p{N}])`;
    const phrase = DA_IDIOM.test(w) ? `(?:(?:[Ff]or|[Aa]d)\\s+)?${core}(?:\\s+til)?`
      : w === "hell" ? `(?:(?:${[...HELL_BEFORE].join("|")})\\s+)*${core}`
      : core;
    out = out.replace(new RegExp(phrase, w === "dick" ? "gu" : "giu"), " ");
  }
  out = out.replace(/\s+/g, " ")
    .replace(/\s+([,.;:?？])/g, "$1")
    .replace(/([,;:])(\s*[,;:])+/g, "$1")
    .replace(/[,;:]+([.?？])/g, "$1")
    .replace(/^[\s,;:.]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
  const first = text.trimStart()[0] ?? "";
  if (out && first !== first.toLowerCase()) out = out[0].toUpperCase() + out.slice(1);
  if (hit.exclamations.length) out = fixExclamations(out) || out;
  return wordCount(out) >= 2 && out !== text.trim() && houseCheck(out) === null ? out : "";
}
