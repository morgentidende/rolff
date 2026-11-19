// Deterministic house rules: swear words (da+en) and exclamation marks. Synthetic text only; providers are mocked (no network, no model calls).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { findExclamations, findProfanity, fixExclamations, houseCheck, houseFallbackSuggestion, HOUSE_EXPLANATION } from "../../supabase/functions/_shared/houseRules.ts";
import { EXPLANATION_MAX, moderate, SYSTEM_PROMPT, type ModerationProvider } from "../../supabase/functions/_shared/moderation.ts";
import { filePromptForLang } from "../../supabase/functions/_shared/attachments.ts";

const ALLOW = { decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" };
const mock = (out: unknown | (() => never)): ModerationProvider & { calls: number } => {
  const p = { name: "fake", model: "fake", calls: 0, moderate: () => { p.calls++; return typeof out === "function" ? Promise.reject(new Error("down")) : Promise.resolve(JSON.stringify(out)); } };
  return p;
};

Deno.test("required examples are swear-word hits", () => {
  for (const [msg, word] of [["Lort glemte bøgerne", "Lort"], ["Jeg kan godt skrive lort", "lort"], ["Pisse", "Pisse"], ["fuck", "fuck"], ["for helvede", "helvede"], ["Kan du ikke hente ham, for helvede", "helvede"]]) {
    assertEquals(findProfanity(msg)[0], word, msg);
  }
});

Deno.test("variants and compounds are blocked (da)", () => {
  for (const m of ["lorte", "Lortet er væk", "den lortebil", "dit lortearbejde", "hestelort", "pisser mig af", "pisseirriteret", "PIS", "skideflot", "skide godt", "han er en skiderik", "helvedes", "fanden ta' det", "møgsvin", "røvhul", "knepper", "Fisse"]) {
    assert(findProfanity(m).length > 0, m);
  }
});

Deno.test("variants and compounds are blocked (en)", () => {
  for (const m of ["FUCK", "fucking late", "motherfucker", "fuuuck", "f*ck", "f**k", "sh*t", "shit", "bullshit", "what a shitty day", "horseshit", "bitch", "asshole", "dumbass", "bastard", "damn", "goddamn it", "what the hell", "go to hell", "hell no", "wtf", "crap"]) {
    assert(findProfanity(m).length > 0, m);
  }
});

Deno.test("false positives: innocent words containing the same letters pass", () => {
  for (const m of ["Hent kortet i morgen", "Vi skal til Helsinge", "Scunthorpe er en by", "Penistone og Cockburn", "Dickens og Dick", "Til slut sagde vi det", "Shiitake og shitake", "Pisa og Pisces", "Assistent og classic", "Kan du lave et knep?", "Pikante detaljer og pikkolo", "Pikeren sagde det", "Fuglen vil pikke i brødet", "Skodderne og skodden er lukket", "Skodsborg station", "Kusk og kusine", "Vi spiller poker", "Røveren blev taget", "Fukushima", "Hello og Hellerup", "Mortensen og lortoft".replace("lortoft", "Lorentzen"), "Klassisk analyse", "Hell er et sted i Norge", "Bassist og hornist", "Skidegade".replace("Skidegade", "Skolegade"), "Vi mødes kl. 16.00", "Kan du hente børnene? Tak.", "Møgspreder på marken", "Du kan hente dem i dag."]) {
    assertEquals(findProfanity(m), [], m);
  }
});

Deno.test("capitalisation, punctuation and spacing do not exempt", () => {
  assertEquals(findProfanity("LORT!").length, 1);
  assertEquals(findProfanity("...lort...").length, 1);
  assertEquals(findProfanity("Fuck.").length, 1);
});

Deno.test("exclamation marks: found, including !!, ?! and full-width", () => {
  assertEquals(findExclamations("Det har jeg sagt!"), ["!"]);
  assertEquals(findExclamations("Hvad!! Hvorfor?!"), ["!!", "?!"]);
  assertEquals(findExclamations("Hej！"), ["！"]);
  assertEquals(findExclamations("Kan du hente kl. 16? Tak."), []);
});

Deno.test("exclamation fix: period instead, '?!' becomes '?', nothing left -> ''", () => {
  assertEquals(fixExclamations("Det har jeg sagt!"), "Det har jeg sagt.");
  assertEquals(fixExclamations("Det har jeg sagt!!"), "Det har jeg sagt.");
  assertEquals(fixExclamations("Hvorfor gjorde du det?!"), "Hvorfor gjorde du det?");
  assertEquals(fixExclamations("Hej! Kan du hente kl. 16?"), "Hej. Kan du hente kl. 16?");
  assertEquals(fixExclamations("Hej!Tak"), "Hej. Tak");
  assertEquals(fixExclamations("!!!"), "");
  assertEquals(fixExclamations("Ingen udråbstegn."), "");
  assert(!/[!！‼⁉]/u.test(fixExclamations("Nej!! Nej! Nej?!")));
});

Deno.test("moderate: exclamation mark is blocked without any model call, marks it and suggests a period", async () => {
  const p = mock(ALLOW);
  const r = await moderate(p, "Det har jeg sagt!", []);
  assertEquals([r.decision, r.reason_code, r.spans, r.suggestion, r.house, p.calls], ["block", "other_harmful", ["!"], "Det har jeg sagt.", "exclamation", 0]);
  const r2 = await moderate(p, "Hvad?!", []);
  assertEquals([r2.decision, r2.spans, r2.suggestion], ["block", ["?!"], "Hvad?"]);
  const r3 = await moderate(p, "!!", []);
  assertEquals([r3.decision, r3.spans, r3.suggestion], ["block", ["!!"], ""]);
  assertEquals(p.calls, 0);
});

Deno.test("moderate: swear word is blocked even when the model says allow or is down (never depends on the model)", async () => {
  for (const p of [mock(ALLOW), mock(() => { throw new Error("x"); })]) {
    for (const msg of ["Lort glemte bøgerne", "Jeg kan godt skrive lort", "Pisse", "fuck", "for helvede"]) {
      const r = await moderate(p, msg, []);
      assertEquals([r.decision, r.reason_code, r.house], ["block", "other_harmful", "profanity"], msg);
      assert(r.spans.length >= 1 && r.spans.every((s) => msg.includes(s)), msg);
      // The model gave no rewrite: only the deterministic fallback (flagged word removed) may appear, and only when it is clean.
      assertEquals(r.suggestion, houseFallbackSuggestion(msg), msg);
      assert(r.suggestion === "" || houseCheck(r.suggestion) === null, msg);
    }
  }
});

Deno.test("moderate: swear word block keeps the model's polite rewrite when it is clean", async () => {
  const msg = "Lort glemte bøgerne";
  const ok = mock({ decision: "block", reason_code: "other_harmful", spans: ["Lort"], suggestion: "Kan du huske bøgerne næste gang?", explanation: "" });
  const r = await moderate(ok, msg, []);
  assertEquals([r.decision, r.spans, r.suggestion], ["block", ["Lort"], "Kan du huske bøgerne næste gang?"]);
  // A rewrite that still contains a swear word or '!' is never shown (the clean deterministic fallback is offered instead).
  const bad = await moderate(mock({ decision: "block", reason_code: "other_harmful", spans: ["Lort"], suggestion: "Lort, husk bøgerne", explanation: "" }), msg, []);
  assertEquals(bad.suggestion, "Glemte bøgerne");
  const excl = await moderate(mock({ decision: "block", reason_code: "other_harmful", spans: ["Lort"], suggestion: "Husk bøgerne!", explanation: "" }), msg, []);
  assert(!/!/.test(excl.suggestion));
});

Deno.test("moderate: swear word and '!' together mark both", async () => {
  const r = await moderate(mock(ALLOW), "Fuck, det har jeg sagt!", []);
  assertEquals([r.decision, r.house, r.spans], ["block", "both", ["Fuck", "!"]]);
});

Deno.test("moderate: ordinary harmless messages still reach the model and pass", async () => {
  const p = mock(ALLOW);
  for (const m of ["Kan du hente børnene kl. 16?", "Vi skal til Helsinge, og kortet ligger i tasken.", "Could you send the Scunthorpe address, please?", "Tak, det var en god dag."]) {
    const r = await moderate(p, m, []);
    assertEquals(r.decision, "allow", m);
    assertEquals("house" in r, false);
  }
  assertEquals(p.calls, 4);
});

Deno.test("explanations: da + en for every kind, short, Rolff only (no pronoun, no model name)", () => {
  for (const kind of ["profanity", "exclamation", "both"] as const) {
    for (const lang of ["da", "en"] as const) {
      const t = HOUSE_EXPLANATION[kind][lang];
      assert(t.length > 20 && [...t].length <= EXPLANATION_MAX, `${kind}/${lang} ${[...t].length}`);
      assert(/Rolff/.test(t));
      assert(!/\b(han|hun|ham|hende|he|she|him|her|his|it)\b/i.test(t), t);
      assert(!/gpt|gemini|openai|luna|grok|claude|model/i.test(t), t);
      assert(!/[!！]/.test(t));
    }
  }
});

Deno.test("prompt (text and file) tells the model to block swear words, with rewrite and no '!'", () => {
  for (const p of [SYSTEM_PROMPT, filePromptForLang("en")]) {
    assert(p.includes("BLOCK profanity, swear words"));
    assert(p.includes("Never use exclamation marks"));
  }
});

Deno.test("houseCheck: file text can skip the exclamation rule", () => {
  assertEquals(houseCheck("Tak for det!", { exclamations: false }), null);
  assertEquals(houseCheck("Tak for det!")?.kind, "exclamation");
});

Deno.test("mild swear words from Nicolai: sgu, pokker, skidt, skod (+ compounds and variants)", () => {
  for (const m of ["Det er sgu ikke rigtigt", "SGU", "for pokker", "pokkers også", "Skidt!", "det skidtvejr", "skidtet", "Din skodbil", "skod", "skodbøger", "skodtøj", "SKOD", "skiiidt"]) {
    assert(findProfanity(m).length > 0, m);
  }
});

Deno.test("kusse and pik are blocked with variants; pikant/pikkolo/pikere/pikke (to peck) pass", () => {
  for (const m of ["kusse", "Kussen", "kusser", "Kusserne", "kussefjæs", "KUSSE", "pik", "Pikken", "pikhoved", "piksvin", "pussy", "cunts"]) {
    assert(findProfanity(m).length > 0, m);
  }
  for (const m of ["pikant", "pikkolo", "pikere", "pikke", "Pikante krydderier", "En pikkolo-flaske", "Skodde og skodder", "Skodsborg", "Kusk", "kusine"]) {
    assertEquals(findProfanity(m), [], m);
  }
});

Deno.test("30 approved words: blocked with common inflections/compounds", () => {
  for (const m of ["satan", "satans", "satanisk", "kraftedeme", "sateme", "satme", "knald", "knalder", "knaldet", "pikhoved", "pikfjæs", "fissehoved", "røvbanan", "lorteunge", "horeunge", "tøs", "tøsen", "tøser", "tøsedreng", "idiotisk", "idiotiske", "dumrian", "tåbe", "tåber", "tåbelig", "fjols", "fjolset", "spasser", "spassere", "mongol", "Mongol", "evnesvag", "evnesvagt", "retarderet", "retarderede", "åndssvag", "åndssvagt", "hjernedød", "hjernedøde", "fedeso", "tyksak", "tyksakke", "tumpe", "tumper", "kvajhoved", "dick", "moron", "morons", "loser", "stupid", "STUPID", "Hvad laver du, dumrian?"]) {
    assert(findProfanity(m).length > 0, m);
  }
});

Deno.test("30 approved words: innocent look-alikes pass (Mongoliet, mongolsk, Dick, Dickens, tøsne, knaldrød ...)", () => {
  for (const m of ["Vi rejser til Mongoliet", "Han taler mongolsk", "Mongoler bor i Mongoliet", "Det mongolske rige", "Mongol Empire og Mongol hæren", "Dick", "Dick Cheney og Dickens", "Hej Dick, kan du hente?", "Dicks", "Der falder tøsne", "En knaldrød bil", "Knaldhat og knaldert", "Moroni og Morocco", "Loseren", "Stupa og stupaer", "Retardering af forløbet", "Hjernedøden blev konstateret", "Tumpet", "Sateliit"]) {
    assertEquals(findProfanity(m), [], m);
  }
});

Deno.test("only lowercase standalone 'dick' is blocked, and the span is the word", () => {
  assertEquals(findProfanity("du er en dick"), ["dick"]);
  assertEquals(findProfanity("Dick er min onkel"), []);
});

Deno.test("fuck and ALL variants: contains-fuck words, spellings, obfuscations (da+en)", () => {
  for (const m of ["fuck", "fucking", "fuckin", "fuckin'", "fucked", "fucker", "fuckers", "motherfucker", "mf'er", "mfer", "fuckface", "fuckup", "fuckhead", "fucks", "fucke", "fucket", "fuckede", "fuckeren", "fck", "fcking", "fcked", "fuk", "fukking", "fuked", "fuking", "phuck", "phucking", "f*cking", "f**king", "f*ck", "f**k", "fxck", "fxcking", "fu*k", "fu*king", "fu**ing", "FUCK", "Fuck!", "fuuuuck", "fuuucking", "fuckyou", "mofo", "Hvad fanden, fuck det!"]) {
    assert(findProfanity(m).length > 0, m);
  }
  // spans are the whole variant as written
  assertEquals(findProfanity("du er f*cking sen"), ["f*cking"]);
  assertEquals(findProfanity("mf'er"), ["mf'er"]);
  assertEquals(findProfanity("fuckin' late"), ["fuckin"]);
});

Deno.test("fuck variants: look-alikes still pass (Fukushima, initials F.K., fucus, Fuchs)", () => {
  for (const m of ["Fukushima", "F.K. Hansen", "Fuchs og Fuchsia", "Fucus er en tang", "Fuji og Fuka", "Funk og fun", "Fakta om fakir", "Mfa og mfg"]) {
    assertEquals(findProfanity(m), [], m);
  }
});

Deno.test("house explanations are short (one line, shown in full) and exactly the agreed texts", () => {
  assertEquals(HOUSE_EXPLANATION.profanity.da, "Rolff lader ikke bandeord passere.");
  assertEquals(HOUSE_EXPLANATION.exclamation.da, "Rolff lader ikke udråbstegn passere.");
  assertEquals(HOUSE_EXPLANATION.profanity.en, "Rolff doesn't let swear words through.");
  assertEquals(HOUSE_EXPLANATION.exclamation.en, "Rolff doesn't let exclamation marks through.");
  for (const kind of ["profanity", "exclamation", "both"] as const) for (const lang of ["da", "en"] as const) assert([...HOUSE_EXPLANATION[kind][lang]].length <= 60, `${kind}/${lang}`);
});

Deno.test("fallback suggestion: flagged word removed, spaces tidied", () => {
  assertEquals(houseFallbackSuggestion("Sikke noget lort at fyre af"), "Sikke noget at fyre af");
  assertEquals(houseFallbackSuggestion("Sikke   noget   lort   at fyre af"), "Sikke noget at fyre af");
  assertEquals(houseFallbackSuggestion("Lort glemte bøgerne"), "Glemte bøgerne");
  assertEquals(houseFallbackSuggestion("Du har glemt bøgerne, lort."), "Du har glemt bøgerne.");
  assertEquals(houseFallbackSuggestion("Du har glemt lort, bøgerne"), "Du har glemt, bøgerne");
  assertEquals(houseFallbackSuggestion("That was a shit idea"), "That was a idea");
  assertEquals(houseFallbackSuggestion("Det er fucking sent nu"), "Det er sent nu");
  assertEquals(houseFallbackSuggestion("Du er f*cking sen i dag"), "Du er sen i dag");
});

Deno.test("fallback suggestion: several flagged words and fixed phrases", () => {
  assertEquals(houseFallbackSuggestion("Det er lort og pis at vente"), "Det er og at vente");
  assertEquals(houseFallbackSuggestion("Kan du ikke hente ham, for helvede"), "Kan du ikke hente ham");
  assertEquals(houseFallbackSuggestion("Det er ad helvede til sent"), "Det er sent");
  assertEquals(houseFallbackSuggestion("What the hell, you are late"), "You are late");
  assertEquals(houseFallbackSuggestion("Fuck, det har jeg sagt!"), "Det har jeg sagt.");
});

Deno.test("fallback suggestion: only exact flagged words go (look-alikes, other words and names stay)", () => {
  assertEquals(houseFallbackSuggestion("Dick kan hente, du er en dick"), "Dick kan hente, du er en");
  assertEquals(houseFallbackSuggestion("Kortet er lort i dag"), "Kortet er i dag");
});

Deno.test("fallback suggestion: not offered when fewer than 2 words are left", () => {
  for (const m of ["Lort", "Pisse", "fuck", "Lort!", "Fuck fuck fuck", "lort ... pis", "Helvede", "Nej lort"]) assertEquals(houseFallbackSuggestion(m), "", m);
});

Deno.test("fallback suggestion: not offered without a swear word (clean text, '!' only is handled elsewhere)", () => {
  assertEquals(houseFallbackSuggestion("Kan du hente børnene kl. 16?"), "");
  assertEquals(houseFallbackSuggestion("Det har jeg sagt!"), "");
  assertEquals(houseFallbackSuggestion(""), "");
});

Deno.test("fallback suggestion: never contains a swear word or '!' (house rules re-checked)", () => {
  for (const m of ["Det er lort og fuck, og pis!", "Hold dine lortehænder væk", "Du er en idiot, tøs og fjols", "du er en dick!!", "Skod, skod, skod og mere skod", "Hej Hej lort lorte lortet lortebil", "f*ck f**k fuuuck det er sent"]) {
    const s = houseFallbackSuggestion(m);
    assert(s === "" || (houseCheck(s) === null && !/[!！]/.test(s)), `${m} -> ${s}`);
  }
  // A leftover the removal cannot reach (a 6th distinct swear word is beyond the span cap) -> no suggestion at all.
  assertEquals(houseFallbackSuggestion("lort pis skod sgu pokker skidt og fanden"), "");
});

Deno.test("moderate: model gives no rewrite -> deterministic fallback is used (model allow, model down, empty rewrite)", async () => {
  for (const p of [mock(ALLOW), mock(() => { throw new Error("x"); }), mock({ decision: "block", reason_code: "other_harmful", spans: ["lort"], suggestion: "", explanation: "" })]) {
    const r = await moderate(p, "Sikke noget lort at fyre af", []);
    assertEquals([r.decision, r.house, r.suggestion], ["block", "profanity", "Sikke noget at fyre af"]);
  }
  // Model rewrite that is itself dirty -> fallback instead.
  const dirty = await moderate(mock({ decision: "block", reason_code: "other_harmful", spans: ["lort"], suggestion: "Sikke noget lort!", explanation: "" }), "Sikke noget lort at fyre af", []);
  assertEquals(dirty.suggestion, "Sikke noget at fyre af");
  // Model rewrite wins when it is clean.
  const ok = await moderate(mock({ decision: "block", reason_code: "other_harmful", spans: ["lort"], suggestion: "Det var ikke fint at sige.", explanation: "" }), "Sikke noget lort at fyre af", []);
  assertEquals(ok.suggestion, "Det var ikke fint at sige.");
});

Deno.test("moderate: no suggestion when the fallback is not allowed (single word) and '!' keeps its own suggestion", async () => {
  const r = await moderate(mock(ALLOW), "Lort", []);
  assertEquals([r.decision, r.suggestion], ["block", ""]);
  const e = await moderate(mock(ALLOW), "Det har jeg sagt!", []);
  assertEquals(e.suggestion, "Det har jeg sagt.");
});
