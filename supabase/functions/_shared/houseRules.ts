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
  /^\p{L}*fuck\p{L}*$/u, /^fuk(king|ker)?$/u, /^fck(ing)?$/u,
  /^(bull|horse|dip|ape|bat|chicken|dog|cow|jack|no)?shit(s|ty|ting|ted|e|head|hole|show|storm|face|bag|load)?$/u,
  /^bitch(es|y|ing)?$/u, /^a(ss|rse)holes?$/u, /^(dumb|jack|smart|fat|bad)ass(es)?$/u,
  /^motherfuck\p{L}*$/u, /^bastard(s)?$/u, /^bollocks$/u, /^wanker(s)?$/u, /^twat(s)?$/u, /^dickhead(s)?$/u,
  /^cocksucker(s)?$/u, /^slutty$/u, /^crap(py)?$/u, /^(god)?damn(ed|it)?$/u, /^dammit$/u, /^goddam$/u,
  /^wtf$/u, /^stfu$/u, /^ffs$/u,
];
// Common symbol-obfuscated forms in the raw text: f*ck, f**k, sh*t, b*tch.
const OBFUSCATED = /(?<![\p{L}\p{N}])(?:f[*@#.\-_]{1,3}(?:c?k)|f[u][*@#]k|sh[*@#]t|b[*@#]tch|fu[*@#]{1,2})(?![\p{L}\p{N}])/giu;
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

/** Sender-facing texts (max 140 chars). User-facing: "Rolff" only, never a pronoun, no model name. */
export const HOUSE_EXPLANATION: Record<HouseKind, Record<AppLang, string>> = {
  profanity: {
    da: "Rolff lader ikke grove ord og bandeord passere, heller ikke når de ikke er rettet mod nogen. Prøv uden ordet.",
    en: "Rolff doesn't let swear words or crude language through, even when they aren't aimed at anyone. Try without the word.",
  },
  exclamation: {
    da: "Udråbstegn kan lyde som råb eller et påbud, så Rolff afviser dem. Prøv et punktum i stedet.",
    en: "Exclamation marks can sound like shouting or an order, so Rolff doesn't allow them. Try a period instead.",
  },
  both: {
    da: "Rolff afviser grove ord, bandeord og udråbstegn, også når de ikke er rettet mod nogen. Prøv uden dem.",
    en: "Rolff doesn't allow swear words, crude language or exclamation marks, even when not aimed at anyone. Try without them.",
  },
};
