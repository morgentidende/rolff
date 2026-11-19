// Sticky blocks: the same blocked text cannot slip through on a later, non-deterministic model allow.
// Synthetic text only; no network.
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { applySticky, normalizeForSticky, stickyHash } from "../../supabase/functions/_shared/stickyBlock.ts";
import { moderate, type ModerationProvider, type ModerationResult } from "../../supabase/functions/_shared/moderation.ts";

const MSG = "Hvorfor gjorde du ikke det sløve arbejde?";
const allow: ModerationResult = { decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" };
const clarify: ModerationResult = { decision: "clarify", reason_code: "unclear_meaning", spans: [], suggestion: "", explanation: "" };
const fake = (out: unknown): ModerationProvider => ({ name: "fake", model: "fake", moderate: () => Promise.resolve(out) });

Deno.test("normalization ignores case, spacing and punctuation but not wording", async () => {
  assertEquals(normalizeForSticky("  Hvorfor  GJORDE du ikke det sløve arbejde?! "), "hvorfor gjorde du ikke det sløve arbejde");
  assertEquals(await stickyHash(MSG), await stickyHash("hvorfor gjorde du ikke det sløve arbejde"));
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
  const fresh: ModerationResult = { decision: "block", reason_code: "personal_attack", spans: ["sløve"], suggestion: "Hvorfor gjorde du ikke arbejdet?", explanation: "" };
  assertEquals(applySticky({ ...fresh }, "personal_attack"), fresh);
});

Deno.test("no memory, or invalid memory, leaves an allow untouched", () => {
  for (const m of [null, undefined, "", "none", "unclear_meaning", "nonsense", 42]) assertEquals(applySticky({ ...allow }, m).decision, "allow");
});

// ---- 19/11 false positive: "Udråbstegn blokeres nu!" (house block) made "Udråbstegn blokeres nu." sticky-blocked ----
import { shouldRememberBlock } from "../../supabase/functions/_shared/stickyBlock.ts";
import { houseCheck } from "../../supabase/functions/_shared/houseRules.ts";

const EXCL = "Udråbstegn blokeres nu!";
const FIXED = "Udråbstegn blokeres nu.";
const neverCalled: ModerationProvider = { name: "fake", model: "fake", moderate: () => Promise.reject(new Error("model must not be called for an exclamation-only block")) };

Deno.test("meta-talk about exclamation marks passes the house rules; only the real '!' is a house hit", () => {
  assertEquals(houseCheck(FIXED), null);
  assertEquals(houseCheck("Udråbstegn blokeres nu")?.kind, undefined);
  assertEquals(houseCheck(EXCL)?.kind, "exclamation");
});

Deno.test("sticky key ignores '!' vs '.', which is why house blocks must not be remembered", async () => {
  assertEquals(await stickyHash(EXCL), await stickyHash(FIXED));
});

Deno.test("house blocks are not remembered; model blocks and sticky refreshes are", async () => {
  const res = await moderate(neverCalled, EXCL, []);
  assertEquals(res.decision, "block");
  assertEquals(res.source, "house");
  assertEquals(shouldRememberBlock(res), false);
  const modelBlock = await moderate(fake({ decision: "block", reason_code: "personal_attack", spans: [], suggestion: "", explanation: "" }), "Du er altid så sur", []);
  assertEquals(shouldRememberBlock(modelBlock), true);
  assertEquals(shouldRememberBlock(applySticky({ ...allow }, "personal_attack")), true);
  assertEquals(shouldRememberBlock(allow), false);
  assertEquals(shouldRememberBlock({ ...clarify }), false);
});

Deno.test("regression: after a house block of the '!' text, the suggested '.' text is judged fresh and goes through on allow", async () => {
  const memory = new Map<string, string>(); // stands in for moderation_block_memory (send-message flow)
  const send = async (text: string, provider: ModerationProvider) => {
    const key = await stickyHash(text);
    let res = applySticky(await moderate(provider, text, []), memory.get(key));
    if (shouldRememberBlock(res)) memory.set(key, res.reason_code);
    return res;
  };
  const first = await send(EXCL, neverCalled);
  assertEquals(first.decision, "block");
  assertEquals(first.suggestion, FIXED);
  const second = await send(FIXED, fake(allow));
  assertEquals(second.decision, "allow");
});

Deno.test("a genuine model block is still sticky across punctuation (fail strict kept)", async () => {
  const memory = new Map<string, string>();
  const send = async (text: string, provider: ModerationProvider) => {
    const key = await stickyHash(text);
    const res = applySticky(await moderate(provider, text, []), memory.get(key));
    if (shouldRememberBlock(res)) memory.set(key, res.reason_code);
    return res;
  };
  const block = fake({ decision: "block", reason_code: "personal_attack", spans: [], suggestion: "", explanation: "" });
  assertEquals((await send("Du er altid så sur", block)).decision, "block");
  const again = await send("Du er altid så sur.", fake(allow));
  assertEquals(again.decision, "block");
  assertEquals(again.reason_code, "personal_attack");
});
