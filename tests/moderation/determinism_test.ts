// Luna determinism: fixed seed, temperature 0 only with reasoning_effort "none", byte-stable payloads,
// optional double check. Synthetic text only; fetch is mocked (no network, no model calls).
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { buildUserPayload, doubleCheckFromEnv, moderate, MODERATION_SEED, ModerationTechnicalError, OpenAIProvider, openAISampling, providerFromEnv, reasoningEffortFromEnv, type ModerationProvider } from "../../supabase/functions/_shared/moderation.ts";

const MSG = "Hvorfor afleverede du ikke de der bøger?";
const CTX = [{ mine: false, body: "Hej" }, { mine: true, body: "Hej igen" }];
const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
const ALLOW = { decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" };
const BLOCK = { decision: "block", reason_code: "personal_attack", spans: ["de der"], suggestion: "Hvorfor afleverede du ikke bøgerne?", explanation: "" };
const CLARIFY = { decision: "clarify", reason_code: "unclear_meaning", spans: [], suggestion: "", explanation: "" };
const seq = (...outs: unknown[]): ModerationProvider & { calls: number } => {
  const p = { name: "fake", model: "fake", calls: 0, moderate: () => { const o = outs[Math.min(p.calls, outs.length - 1)]; p.calls++; return o instanceof Error ? Promise.reject(o) : Promise.resolve(JSON.stringify(o)); } };
  return p;
};
async function captureBodies(p: OpenAIProvider, n = 2): Promise<string[]> {
  const orig = globalThis.fetch; const bodies: string[] = [];
  globalThis.fetch = (async (_u: string, init: any) => { bodies.push(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ALLOW) } }] })); }) as typeof fetch;
  try { for (let i = 0; i < n; i++) await p.moderate(MSG, CTX, new AbortController().signal); } finally { globalThis.fetch = orig; }
  return bodies;
}

Deno.test("sampling: seed always; temperature 0 only together with reasoning_effort none", () => {
  assertEquals(openAISampling(), { seed: MODERATION_SEED });
  assertEquals(openAISampling("none"), { seed: MODERATION_SEED, reasoning_effort: "none", temperature: 0 });
  assertEquals(openAISampling("medium"), { seed: MODERATION_SEED, reasoning_effort: "medium" });
  for (const e of ["low", "medium", "high", "xhigh", "max"] as const) assert(!("temperature" in openAISampling(e)));
});

Deno.test("OpenAI request bodies are byte-identical for identical input (stable ordering)", async () => {
  for (const effort of [undefined, "none", "low"] as const) {
    const [a, b] = await captureBodies(new OpenAIProvider("sk-test", "gpt-6-luna", undefined, undefined, effort));
    assertEquals(a, b);
    const j = JSON.parse(a);
    assertEquals(j.model, "gpt-6-luna");
    assertEquals(j.seed, MODERATION_SEED);
    assertEquals("temperature" in j, effort === "none");
  }
  assertEquals(buildUserPayload(MSG, CTX), buildUserPayload(MSG, CTX.map((c) => ({ body: c.body, mine: c.mine }))));
});

Deno.test("env: reasoning effort parsing; invalid value is a config error (fail closed)", () => {
  assertEquals(reasoningEffortFromEnv(env({})), undefined);
  assertEquals(reasoningEffortFromEnv(env({ OPENAI_REASONING_EFFORT: " None " })), "none");
  assertThrows(() => reasoningEffortFromEnv(env({ OPENAI_REASONING_EFFORT: "zero" })), ModerationTechnicalError);
  assertThrows(() => providerFromEnv(env({ MODERATION_PROVIDER: "openai", MODERATION_TIER: "paid", OPENAI_API_KEY: "sk-test", OPENAI_REASONING_EFFORT: "zero" })), ModerationTechnicalError);
});

Deno.test("provider and model choice are unchanged", () => {
  const p = providerFromEnv(env({ MODERATION_PROVIDER: "openai", MODERATION_TIER: "paid", OPENAI_API_KEY: "sk-test" }));
  assertEquals([p.name, p.model], ["openai", "gpt-6-luna"]);
});

Deno.test("double check flag is OFF by default", () => {
  assertEquals(doubleCheckFromEnv(env({})), false);
  assertEquals(doubleCheckFromEnv(env({ MODERATION_DOUBLE_CHECK: "off" })), false);
  assertEquals(doubleCheckFromEnv(env({ MODERATION_DOUBLE_CHECK: "on" })), true);
});

Deno.test("without double check: one call, verdict as before", async () => {
  const p = seq(ALLOW, BLOCK);
  assertEquals((await moderate(p, MSG, [])).decision, "allow");
  assertEquals(p.calls, 1);
});

Deno.test("double check: allow then block => block (either blocks)", async () => {
  const p = seq(ALLOW, BLOCK);
  const r = await moderate(p, MSG, [], 15000, { doubleCheck: true });
  assertEquals([r.decision, r.reason_code, r.checks, p.calls], ["block", "personal_attack", 2, 2]);
});

Deno.test("double check: allow then clarify => clarify; allow+allow => allow", async () => {
  assertEquals((await moderate(seq(ALLOW, CLARIFY), MSG, [], 15000, { doubleCheck: true })).decision, "clarify");
  assertEquals((await moderate(seq(ALLOW, ALLOW), MSG, [], 15000, { doubleCheck: true })).decision, "allow");
});

Deno.test("double check: a first block/clarify is final (no second call)", async () => {
  for (const first of [BLOCK, CLARIFY]) { const p = seq(first, ALLOW); await moderate(p, MSG, [], 15000, { doubleCheck: true }); assertEquals(p.calls, 1); }
});

Deno.test("double check: second-call error fails closed", async () => {
  await assertRejects(() => moderate(seq(ALLOW, new Error("boom")), MSG, [], 15000, { doubleCheck: true }), ModerationTechnicalError);
  await assertRejects(() => moderate(seq(ALLOW, { decision: "maybe" }), MSG, [], 15000, { doubleCheck: true }), ModerationTechnicalError);
});
