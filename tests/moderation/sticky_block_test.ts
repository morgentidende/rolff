// Sticky blocks: the same blocked text cannot slip through on a later, non-deterministic model allow.
// Synthetic text only; no network.
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { applySticky, normalizeForSticky, stickyHash } from "../../supabase/functions/_shared/stickyBlock.ts";
import { moderate, type ModerationProvider, type ModerationResult } from "../../supabase/functions/_shared/moderation.ts";

const MSG = "Hvorfor gjorde du ikke det lorte-arbejde?";
const allow: ModerationResult = { decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" };
const clarify: ModerationResult = { decision: "clarify", reason_code: "unclear_meaning", spans: [], suggestion: "", explanation: "" };
const fake = (out: unknown): ModerationProvider => ({ name: "fake", model: "fake", moderate: () => Promise.resolve(out) });

Deno.test("normalization ignores case, spacing and punctuation but not wording", async () => {
  assertEquals(normalizeForSticky("  Hvorfor  GJORDE du ikke det lorte-arbejde?! "), "hvorfor gjorde du ikke det lorte arbejde");
  assertEquals(await stickyHash(MSG), await stickyHash("hvorfor gjorde du ikke det lorte arbejde"));
  assertNotEquals(await stickyHash(MSG), await stickyHash("Hvorfor gjorde du ikke det arbejde?"));
  assertEquals((await stickyHash(MSG)).length, 64);
});

Deno.test("hash never contains the text", async () => {
  const h = await stickyHash(MSG);
  assertEquals(/^[0-9a-f]{64}$/.test(h), true);
});

Deno.test("remembered block overrides a later allow (the 13/11 bypass)", async () => {
  const later = await moderate(fake(allow), MSG, []);
  assertEquals(later.decision, "allow");
  const r = applySticky(later, "personal_attack");
  assertEquals(r.decision, "block");
  assertEquals(r.reason_code, "personal_attack");
  assertEquals(r.spans, []);
  assertEquals(r.suggestion, "");
});

Deno.test("remembered block overrides clarify too", () => {
  assertEquals(applySticky({ ...clarify }, "humiliation_mockery").decision, "block");
});

Deno.test("fresh block keeps its own suggestion/spans", () => {
  const fresh: ModerationResult = { decision: "block", reason_code: "personal_attack", spans: ["lorte"], suggestion: "Hvorfor gjorde du ikke arbejdet?", explanation: "" };
  assertEquals(applySticky({ ...fresh }, "personal_attack"), fresh);
});

Deno.test("no memory, or invalid memory, leaves an allow untouched", () => {
  for (const m of [null, undefined, "", "none", "unclear_meaning", "nonsense", 42]) assertEquals(applySticky({ ...allow }, m).decision, "allow");
});
