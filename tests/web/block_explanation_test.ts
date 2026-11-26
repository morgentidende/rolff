import { assertEquals } from "jsr:@std/assert@1";
import { cleanExplanation, EXPLANATION_CLIENT_MAX } from "../../apps/web/src/blockExplanation.ts";
Deno.test("client guard: plain text only, bounded, else empty (standard text)", () => {
  assertEquals(cleanExplanation(" Tonen kan <i>virke</i> hård.\u0007 "), "Tonen kan virke hård.");
  for (const bad of [undefined, null, 1, {}, "", "<b></b>", "x".repeat(EXPLANATION_CLIENT_MAX + 1)]) assertEquals(cleanExplanation(bad), "");
  assertEquals(cleanExplanation("æ".repeat(EXPLANATION_CLIENT_MAX)).length, EXPLANATION_CLIENT_MAX);
});
Deno.test("cleanExplanation drops the unused 'played no role' sentence and keeps the rest", () => {
  assertEquals(cleanExplanation("“Er du glad nu?” kan komme til at lyde sarkastisk. Tidligere beskeder har ikke spillet en rolle."), "“Er du glad nu?” kan komme til at lyde sarkastisk.");
  assertEquals(cleanExplanation('The wording may sound sarcastic. Earlier messages played no role.'), "The wording may sound sarcastic.");
});
