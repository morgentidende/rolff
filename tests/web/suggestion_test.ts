import { assertEquals } from "jsr:@std/assert@1";
import { applySuggestion } from "../../apps/web/src/suggestion.ts";
Deno.test("Brug forslaget kopierer forslag, tomt beholder original", () => {
  assertEquals(applySuggestion("Du skal hente nu", "Kan vi aftale afhentning kl. 16?"), "Kan vi aftale afhentning kl. 16?");
  assertEquals(applySuggestion("original", ""), "original");
  assertEquals(applySuggestion("original", null), "original");
});
