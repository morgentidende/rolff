// Regression 19/11: "Udråbstegn blokeres nu." was blocked in a chat whose recent context was irritated / rule related,
// but sent fine in a chat without context. Context may inform the judgment; a message that is neutral on its own must not
// be blocked because of earlier context. Synthetic text only; mocked fetch, no network, no real model.
import { assertEquals, assert } from "jsr:@std/assert@1";
import { moderate, moderationContract, OpenAIProvider, SYSTEM_PROMPT, systemPromptForLang, validateResult, type ContextMsg, type ModerationProvider } from "../../supabase/functions/_shared/moderation.ts";

const META = "Udråbstegn blokeres nu.";
const TENSE_CTX: ContextMsg[] = [
  { mine: false, body: "Det har jeg sagt!" },
  { mine: true, body: "En ret tydeligt irriteret besked, måske en regel omkring udråbstegn?" },
];
const allow = { decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" };

Deno.test("prompt (da and en) says context never blocks by itself and lists neutral meta-talk to allow", () => {
  for (const p of [SYSTEM_PROMPT, systemPromptForLang("da"), systemPromptForLang("en"), moderationContract("en").prompt]) {
    assert(p.includes("CONTEXT NEVER BLOCKS BY ITSELF"));
    assert(p.includes("ONLY for understanding what the NEW MESSAGE refers to"));
    assert(p.includes("neutral on its own must NEVER be blocked"));
    assert(p.includes("TALKING ABOUT rules, words, punctuation"));
    assert(p.includes('"Udråbstegn blokeres nu."'));
    assert(p.includes("wording of the NEW MESSAGE itself"));
  }
});

Deno.test("hostile-wording rules are untouched by the meta-talk examples", () => {
  for (const s of ["personal attacks", "controlling_demand", "BLOCK profanity", "BETTER SAFE THAN SORRY", "sarcasm or irony used to hurt"]) assert(SYSTEM_PROMPT.includes(s), s);
});

Deno.test("mocked OpenAI: the request carries the tense context separately from the new message, and the new prompt", async () => {
  const orig = globalThis.fetch; let sysPrompt = "", user: any = null;
  globalThis.fetch = (async (_u: string, init: any) => {
    const b = JSON.parse(init.body); sysPrompt = b.messages[0].content; user = JSON.parse(b.messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(allow) } }] }), { status: 200 });
  }) as any;
  try {
    const r = await moderate(new OpenAIProvider("sk-test", "m", "https://eu.api.openai.com/v1", moderationContract("da")), META, TENSE_CTX);
    assertEquals(r.decision, "allow");
    assertEquals(user.new_message, META);
    assertEquals(user.context.length, 2);
    assert(!JSON.stringify(user.new_message).includes("irriteret"));
    assert(sysPrompt.includes("CONTEXT NEVER BLOCKS BY ITSELF"));
  } finally { globalThis.fetch = orig; }
});

Deno.test("a neutral new message is allowed with and without tense context (mocked context-insensitive verdict)", async () => {
  const seen: number[] = [];
  const model: ModerationProvider = { name: "fake", model: "fake", moderate: (_m, ctx) => { seen.push(ctx.length); return Promise.resolve(allow); } };
  assertEquals((await moderate(model, META, [])).decision, "allow");
  assertEquals((await moderate(model, META, TENSE_CTX)).decision, "allow");
  assertEquals(seen, [0, 2]);
});

Deno.test("house rules do not hit the meta-talk sentence, so it reaches the model path and not a deterministic block", async () => {
  const r = await moderate({ name: "fake", model: "fake", moderate: () => Promise.resolve(allow) }, META, TENSE_CTX);
  assertEquals(r.source, "ai");
});

Deno.test("fail strict is kept: a context-driven block with no span in the new message is still a block", () => {
  const r = validateResult({ decision: "block", reason_code: "other_harmful", spans: ["Det har jeg sagt!"], suggestion: "", explanation: "" }, META);
  assertEquals(r.decision, "block");
  assertEquals(r.spans, []); // spans copied from the context are dropped, never shown as the sender's words
});
