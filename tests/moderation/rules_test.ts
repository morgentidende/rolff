import { assertEquals } from "jsr:@std/assert@1";
import { checkRules, findBlockedWord, findEmoticon, hasEmoji, hasEmoticon, isRepeat, isShouting } from "../../supabase/functions/_shared/rules.ts";

Deno.test("blokeret ord: match hele ord, case", () => assertEquals(findBlockedWord("Det er noget PIS!", ["pis"]), "PIS"));
Deno.test("blokeret ord: ikke-match i længere ord", () => assertEquals(findBlockedWord("Han har et pispot", ["pis"]), null));
Deno.test("blokeret ord: stamme med *", () => assertEquals(findBlockedWord("Han har et pispot", ["pis*"]), "pispot"));
Deno.test("blokeret ord: diakritik", () => { assertEquals(findBlockedWord("Det er et cafe-problem", ["café"]), "cafe"); assertEquals(findBlockedWord("Din CAFÉ", ["cafe"]), "CAFÉ"); });
Deno.test("blokeret ord: æøå bevares", () => { assertEquals(findBlockedWord("Hør her", ["hør"]), "Hør"); assertEquals(findBlockedWord("Hor her", ["hør"]), null); });
Deno.test("blokeret udtryk: flere ord", () => { assertEquals(findBlockedWord("Du er en  dårlig   mor.", ["dårlig mor"]), "dårlig   mor"); assertEquals(findBlockedWord("dårlig vejr, mor", ["dårlig mor"]), null); });
Deno.test("blokeret ord: ingen liste", () => assertEquals(findBlockedWord("hej", []), null));
Deno.test("emoji afvises", () => { assertEquals(hasEmoji("Fint 🙂"), true); assertEquals(hasEmoji("ok 👍🏽"), true); assertEquals(hasEmoji("❤️"), true); assertEquals(hasEmoji("🇩🇰"), true); });
Deno.test("ikke-emoji tilladt", () => { assertEquals(hasEmoji("Kl. 16:30 #2 © 2026 – ok? (1/2) * æøå"), false); });
Deno.test("STORE BOGSTAVER", () => { assertEquals(isShouting("HENT HAM NU KL 16"), true); assertEquals(isShouting("Send PDF til OK"), false); assertEquals(isShouting("Mødet er hos DR i morgen"), false); });
Deno.test("gentagelse", () => { assertEquals(isRepeat("Svar mig nu.", ["svar  mig nu!"]), true); assertEquals(isRepeat("Svar mig i morgen", ["Svar mig nu"]), false); });
Deno.test("checkRules rækkefølge: blokeret ord først", () => assertEquals(checkRules("PIS 🙂", ["pis"], []), { rule: "blocked_word", word: "PIS" }));
Deno.test("checkRules: neutral besked passerer", () => assertEquals(checkRules("Kan du hente kl. 16 i stedet?", ["pis"], ["Hej"]), null));

Deno.test("blokeret ord: kun det ramte ord returneres, aldrig listen", async () => {
  const { checkRules } = await import("../../supabase/functions/_shared/rules.ts");
  const hit = checkRules("Det er så TYPISK af dig, Café", ["hemmelig", "typisk", "cafe"], []);
  if (!hit || hit.rule !== "blocked_word" || hit.word !== "TYPISK") throw new Error(JSON.stringify(hit));
  if (JSON.stringify(hit).includes("hemmelig")) throw new Error("list leaked");
});


const blocked = (msg: string, face: string) => {
  const hit = findEmoticon(msg);
  if (hit !== face) throw new Error(`${JSON.stringify(msg)} => ${JSON.stringify(hit)}, expected ${JSON.stringify(face)}`);
};
const allowed = (msg: string) => {
  const hit = findEmoticon(msg);
  if (hit !== null) throw new Error(`${JSON.stringify(msg)} unexpectedly matched ${JSON.stringify(hit)}`);
};

Deno.test("tekst-smileys: vestlige ansigter afvises", () => {
  for (const [msg, face] of [
    [":)", ":)"], [":-)", ":-)"], [":(", ":("], [":-(", ":-("],
    [";)", ";)"], [";-)", ";-)"], [":D", ":D"], [":-D", ":-D"],
    [":P", ":P"], [":-P", ":-P"], [":p", ":p"],
    ["xD", "xD"], ["XD", "XD"], ["xd", "xd"],
    [":O", ":O"], [":o", ":o"], [":/", ":/"], [":-/", ":-/"],
    [":|", ":|"], [":*", ":*"], [":')", ":')"], [":'(", ":'("],
    ["=)", "=)"], ["=(", "=("], ["=-)", "=-)"],
    ["8)", "8)"], ["8-)", "8-)"], ["B)", "B)"], ["B-)", "B-)"],
    [":))", ":))"], [":)))", ":)))"], [":((", ":(("], [":((((", ":(((("], [":-))", ":-))"],
    ["(-:", "(-:"], [":-)", ":-)"],
    [":3", ":3"], [">:(", ">:("], [">:-)", ">:-)"],
    [":]", ":]"], [":[", ":["],
  ] as [string, string][]) blocked(msg, face);
});

Deno.test("tekst-smileys: i en sætning, første ansigt returneres", () => {
  blocked("Det er fint :-)", ":-)");
  blocked("nå :(", ":(");
  blocked("ok ;-) så ses vi", ";-)");
  blocked("ha ha :D", ":D");
  blocked("nej :/", ":/");
  blocked("elsker det <3", "<3");
  blocked("så trist </3", "</3");
  blocked("græd :'(", ":'(");
  blocked("glad :')", ":')");
  blocked("ok =)", "=)");
  blocked("trist =(", "=(");
  blocked("cool 8)", "8)");
  blocked("sjovt xD", "xD");
  blocked("wow :O", ":O");
  blocked("hm :|", ":|");
  blocked("knus :*", ":*");
  blocked("sød :3", ":3");
  blocked("ja :))))", ":))))");
  blocked("nå :((((", ":((((");
  blocked("hej ):", "):");
  blocked("hej (:", "(:");
  blocked("hej (-:", "(-:");
  blocked("10:30 er fint :)", ":)");
  blocked("se http://example.com :)", ":)");
  blocked("ærgerligt at det blev 2:1 :(", ":(");
});

Deno.test("tekst-smileys: hjerter, kaomoji og shrug", () => {
  blocked("<3", "<3");
  blocked("</3", "</3");
  blocked("hej ^^", "^^");
  blocked("træt -_-", "-_-");
  blocked("hvad o_O", "o_O");
  blocked("O_o", "O_o");
  blocked("græder T_T", "T_T");
  blocked("ærgerligt >_<", ">_<");
  blocked("¯\\_(ツ)_/¯", "¯\\_(ツ)_/¯");
  blocked("godt (^_^)", "(^_^)");
  blocked("^_^", "^_^");
  blocked("ok (^o^)", "(^o^)");
});

Deno.test("tekst-smileys: tid, stilling, URL og stier tillades", () => {
  for (const msg of [
    "Kl. 16:30",
    "mødet er 10:30",
    "ring 12:00",
    "kl. 8:00",
    "stillingen er 2:1",
    "forholdet 3:2",
    "1:1 samtale",
    "version 1:3a",
    "http://example.com",
    "https://foo.dk/bar",
    "https://example.com/path:80",
    "file://host/path",
    "mailto:user@example.invalid",
    "C:/Users/dokument",
    "se http://example.com i morgen",
  ]) allowed(msg);
});

Deno.test("tekst-smileys: lister, parenteser og kolon i almindelig tekst tillades", () => {
  for (const msg of [
    "se 1) først og 2) siden",
    "a) første punkt\nb) andet",
    "(1) og (2)",
    "mulighed (a) og (b)",
    "se pkt. a)",
    "8) Gå i skole",
    "liste:\n8) Gå i skole\n9) Kom hjem",
    "(se nedenfor)",
    "Bemærk: det er vigtigt",
    "Vigtigt:",
    "Pris: 200 kr",
    "Navn: Anna",
    "Re: dit brev",
    "se kapitel 3:",
    "tid:møde i morgen",
    "se: Dette virker",
    "som aftalt (i dag): vi mødes",
    "(se bilag): i morgen",
    "rapport (2024): side 2",
    "hej med dig",
    "OK",
    ":",
    "smil",
    "f(x) = 1",
    "C:",
  ]) allowed(msg);
});

Deno.test("tekst-smileys: :Dette og <30 er ikke ansigter", () => {
  allowed("Bemærk:Dette");
  allowed("pris <30 kr");
  allowed("under <3.5 procent");
});

Deno.test("checkRules: tekst-smiley rammer efter emoji og før caps, og nævner ansigtet", () => {
  assertEquals(checkRules("Fint :-)", [], []), { rule: "emoticon", word: ":-)" });
  assertEquals(checkRules("PIS :-)", ["pis"], []), { rule: "blocked_word", word: "PIS" });
  assertEquals(checkRules("Fint 🙂 :-)", [], []), { rule: "emoji" });
  assertEquals(hasEmoticon("ok :("), true);
  assertEquals(hasEmoticon("Kl. 16:30"), false);
});
