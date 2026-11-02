import { assertEquals } from "jsr:@std/assert@1";
import { checkRules, findBlockedWord, hasEmoji, isRepeat, isShouting } from "../../supabase/functions/_shared/rules.ts";

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
