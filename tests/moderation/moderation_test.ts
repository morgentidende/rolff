import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { charCount, moderate, ModerationTechnicalError, prefilter, providerFromEnv, validateResult, type ModerationProvider } from "../../supabase/functions/_shared/moderation.ts";
const fake = (out: unknown, delay = 0): ModerationProvider => ({ name: "fake", model: "m", moderate: (_m, _c, signal) => new Promise((res, rej) => { const t = setTimeout(() => res(out), delay); signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("abort")); }); }) });
Deno.test("gyldigt allow", () => assertEquals(validateResult('{"decision":"allow","reason_code":"none","spans":[]}', "hej").decision, "allow"));
Deno.test("ugyldig JSON -> teknisk fejl", () => { assertThrows(() => validateResult("not json", "x"), ModerationTechnicalError); });
Deno.test("ekstra felter afvises (can_send=true)", () => { assertThrows(() => validateResult({ decision: "allow", reason_code: "none", spans: [], can_send: true }, "x"), ModerationTechnicalError); });
Deno.test("ukendt årsagskode afvises", () => { assertThrows(() => validateResult({ decision: "block", reason_code: "foo", spans: [] }, "x"), ModerationTechnicalError); });
Deno.test("inkonsistent allow+årsag afvises", () => { assertThrows(() => validateResult({ decision: "allow", reason_code: "personal_attack", spans: [] }, "x"), ModerationTechnicalError); });
Deno.test("spans der ikke findes i beskeden fjernes", () => assertEquals(validateResult({ decision: "block", reason_code: "personal_attack", spans: ["dum", "findes ikke"] }, "du er dum").spans, ["dum"]));
Deno.test("timeout -> teknisk fejl (fail closed)", async () => { await assertRejects(() => moderate(fake("{}", 200), "hej", [], 20), ModerationTechnicalError, "timeout"); });
Deno.test("provider-fejl -> teknisk fejl", async () => { await assertRejects(() => moderate({ name: "x", model: "m", moderate: () => Promise.reject(new Error("boom")) }, "hej", []), ModerationTechnicalError); });
Deno.test("prefilter fanger entydigt skældsord", () => assertEquals(prefilter("Du er en idiot")?.decision, "block"));
Deno.test("prefilter lader neutral tekst passere til AI", () => assertEquals(prefilter("Kan du hente kl. 16?"), null));
Deno.test("produktion med gratis niveau nægtes", () => { assertThrows(() => providerFromEnv({ get: (k) => ({ APP_ENV: "production", MODERATION_TIER: "free", GEMINI_API_KEY: "x" } as any)[k] }), ModerationTechnicalError, "free_tier_forbidden_in_production"); });
Deno.test("tegnoptælling er Unicode-kodepunkter", () => assertEquals(charCount("æøå👍"), 4));

Deno.test("timeoutFromEnv clamps and defaults", async () => {
  const { timeoutFromEnv } = await import("../../supabase/functions/_shared/moderation.ts");
  const e = (v?: string) => ({ get: (_: string) => v });
  if (timeoutFromEnv(e()) !== 15000) throw new Error("default");
  if (timeoutFromEnv(e("100")) !== 3000) throw new Error("min");
  if (timeoutFromEnv(e("99999")) !== 30000) throw new Error("max");
  if (timeoutFromEnv(e("abc")) !== 15000) throw new Error("nan");
});

Deno.test("OpenAI: EU base-url som standard, store:false, højst 10 kontekstbeskeder (mock, intet netværkskald)", async () => {
  const m = await import("../../supabase/functions/_shared/moderation.ts");
  const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  const p = m.providerFromEnv(env({ MODERATION_PROVIDER: "openai", MODERATION_TIER: "paid", APP_ENV: "test", OPENAI_API_KEY: "sk-test" })) as any;
  if (p.baseUrl !== "https://eu.api.openai.com/v1" || p.model !== "gpt-5.4-nano") throw new Error("defaults");
  const g = m.providerFromEnv(env({ MODERATION_PROVIDER: "openai", MODERATION_TIER: "paid", APP_ENV: "test", OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://api.openai.com/v1" })) as any;
  if (g.baseUrl !== "https://api.openai.com/v1") throw new Error("configurable");
  let threw = false; try { m.providerFromEnv(env({ MODERATION_PROVIDER: "openai", MODERATION_TIER: "paid", OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://evil.example/v1" })); } catch { threw = true; }
  if (!threw) throw new Error("base url allowlist");
  const orig = globalThis.fetch; let seen: any = null;
  globalThis.fetch = (async (url: string, init: any) => { seen = { url, body: JSON.parse(init.body), auth: init.headers.authorization };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "allow", reason_code: "none", spans: [] }) } }] }), { status: 200 }); }) as any;
  try {
    const ctx = Array.from({ length: 15 }, (_, i) => ({ mine: i % 2 === 0, body: `ctx${i}` }));
    await p.moderate("hej", ctx, new AbortController().signal);
  } finally { globalThis.fetch = orig; }
  if (seen.url !== "https://eu.api.openai.com/v1/chat/completions") throw new Error("url " + seen.url);
  if (seen.body.store !== false || seen.body.model !== "gpt-5.4-nano") throw new Error("store/model");
  const payload = JSON.parse(seen.body.messages[1].content);
  if (payload.context.length !== 10 || payload.context[0].text !== "ctx5") throw new Error("ctx");
  if (seen.auth !== "Bearer sk-test") throw new Error("auth");
});
