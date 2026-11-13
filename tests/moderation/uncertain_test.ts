// "uncertain" = borderline tone: Rolff blocks and asks for a rephrase (better safe than sorry).
// Synthetic text only; providers and fetch are mocked (no network, no model calls).
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { moderate, ModerationTechnicalError, OpenAIProvider, REASON_CODES, RESPONSE_SCHEMA, SYSTEM_PROMPT, systemPromptForLang, UNCERTAIN_EXPLANATION, validateResult, type ModerationProvider } from "../../supabase/functions/_shared/moderation.ts";
import { applySticky } from "../../supabase/functions/_shared/stickyBlock.ts";
import { FILE_REASON_CODES, filePromptForLang } from "../../supabase/functions/_shared/attachments.ts";

const MSG = "Hvorfor tog du ikke de skodbøger med?";
const UNC = { decision: "block", reason_code: "uncertain", spans: ["skodbøger"], suggestion: "Hvorfor tog du ikke bøgerne med?", explanation: "" };
const ALLOW = { decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" };
const seq = (...outs: unknown[]): ModerationProvider & { calls: number } => {
  const p = { name: "fake", model: "fake", calls: 0, moderate: () => Promise.resolve(JSON.stringify(outs[Math.min(p.calls++, outs.length - 1)])) };
  return p;
};

Deno.test("reason code and schema include 'uncertain' (text and file)", () => {
  assert((REASON_CODES as readonly string[]).includes("uncertain"));
  assert((RESPONSE_SCHEMA.properties.reason_code.enum as string[]).includes("uncertain"));
  assert((FILE_REASON_CODES as readonly string[]).includes("uncertain"));
});

Deno.test("prompt: borderline tone must block as 'uncertain' with REQUIRED spans + suggestion; clarify stays for meaning", () => {
  for (const p of [SYSTEM_PROMPT, systemPromptForLang("en"), filePromptForLang("da")]) {
    assert(p.includes("BETTER SAFE THAN SORRY"));
    assert(p.includes('reason_code "uncertain"'));
    assert(p.includes("BOTH are REQUIRED"));
    assert(p.includes('"spans" MUST contain the exact doubtful words'));
    assert(p.includes('"suggestion" MUST be one complete, kind rewrite'));
    assert(p.includes('"clarify" stays only for meaning that cannot be understood'));
  }
});

Deno.test("uncertain block keeps the flagged span and the rewrite suggestion", () => {
  const r = validateResult(UNC, MSG);
  assertEquals([r.decision, r.reason_code, r.spans, r.suggestion], ["block", "uncertain", ["skodbøger"], "Hvorfor tog du ikke bøgerne med?"]);
});

Deno.test("uncertain without span/suggestion still blocks (UI falls back to the standard text)", () => {
  const r = validateResult({ ...UNC, spans: [], suggestion: "" }, MSG);
  assertEquals([r.decision, r.reason_code, r.spans, r.suggestion], ["block", "uncertain", [], ""]);
  // A span that is not in the message is dropped, but it is still a block.
  assertEquals(validateResult({ ...UNC, spans: ["findes ikke"] }, MSG).spans, []);
});

Deno.test("'uncertain' is never valid with allow or clarify (fail closed)", () => {
  assertThrows(() => validateResult({ ...ALLOW, reason_code: "uncertain" }, MSG), ModerationTechnicalError);
  assertThrows(() => validateResult({ decision: "clarify", reason_code: "uncertain", spans: [], suggestion: "", explanation: "" }, MSG), ModerationTechnicalError);
});

Deno.test("double check: allow then uncertain => uncertain block with span + suggestion", async () => {
  const r = await moderate(seq(ALLOW, UNC), MSG, [], 15000, { doubleCheck: true });
  assertEquals([r.decision, r.reason_code, r.spans, r.suggestion], ["block", "uncertain", ["skodbøger"], "Hvorfor tog du ikke bøgerne med?"]);
});

Deno.test("sticky: a remembered 'uncertain' block stays blocked", () => {
  assertEquals(applySticky({ decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "" }, "uncertain").reason_code, "uncertain");
});

Deno.test("OpenAI provider (mocked fetch) returns an uncertain block end-to-end", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(UNC) } }] }))) as typeof fetch;
  try { assertEquals((await moderate(new OpenAIProvider("sk-test", "gpt-6-luna"), MSG, [])).reason_code, "uncertain"); }
  finally { globalThis.fetch = orig; }
});

Deno.test("fixed explanation: short, friendly, names Rolff only (no Luna, no pronouns)", () => {
  assertEquals(UNCERTAIN_EXPLANATION.da, "Rolff er lidt i tvivl om, hvordan beskeden vil blive opfattet. Prøv at skrive den lidt anderledes.");
  assertEquals(UNCERTAIN_EXPLANATION.en, "Rolff isn't quite sure how this will come across. Try rephrasing it.");
  for (const t of Object.values(UNCERTAIN_EXPLANATION)) { assert(!/luna|\b(hun|hende|han|ham|she|her|he|him)\b/i.test(t)); assert([...t].length <= 160); }
});
