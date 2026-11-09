// Luna's sender-facing block explanation. Synthetic text only; providers are mocked (no network).
import { assertEquals } from "jsr:@std/assert@1";
import { EXPLANATION_MAX, moderate, OpenAIProvider, prefilter, RESPONSE_SCHEMA, sanitizeExplanation, SYSTEM_PROMPT, validateResult } from "../../supabase/functions/_shared/moderation.ts";
import { FILE_PROMPT, FILE_RESPONSE_SCHEMA, validateFileResult } from "../../supabase/functions/_shared/attachments.ts";

const MSG = "Du skal hente hende kl. 16, punktum.";
const EXPL = "Beskeden kan virke som en kommando og gøre den anden defensiv, så det praktiske let forsvinder.";
const block = (extra: Record<string, unknown> = {}) => ({ decision: "block", reason_code: "controlling_demand", spans: ["Du skal"], suggestion: "Kan du hente hende kl. 16?", ...extra });

Deno.test("block with explanation passes it through; decision/reason/spans/suggestion unchanged", () => {
  const r = validateResult(block({ explanation: EXPL }), MSG);
  assertEquals(r, { decision: "block", reason_code: "controlling_demand", spans: ["Du skal"], suggestion: "Kan du hente hende kl. 16?", explanation: EXPL });
});
Deno.test("missing explanation is accepted (fallback), not a technical error", () => {
  assertEquals(validateResult(block(), MSG).explanation, "");
  assertEquals(validateResult(JSON.stringify(block()), MSG).decision, "block");
});
Deno.test("invalid explanation types fall back to empty", () => {
  for (const e of [null, 42, ["x"], { t: "x" }, true]) assertEquals(validateResult(block({ explanation: e }), MSG).explanation, "");
});
Deno.test("allow/clarify never carry an explanation", () => {
  assertEquals(validateResult({ decision: "allow", reason_code: "none", spans: [], suggestion: "", explanation: "Hej" }, "Hej").explanation, "");
  assertEquals(validateResult({ decision: "clarify", reason_code: "unclear_meaning", spans: [], suggestion: "", explanation: "Uklar" }, "plimvax").explanation, "");
});
Deno.test("other unknown keys still fail closed", () => {
  let thrown = false; try { validateResult(block({ explanation: EXPL, can_send: true }), MSG); } catch { thrown = true; }
  assertEquals(thrown, true);
});
Deno.test("sanitize: strips HTML and control chars, collapses whitespace", () => {
  assertEquals(sanitizeExplanation("  Tonen <b>kan</b> virke\u0000 hård\u200B\n for <script>x</script>modtageren.  "), "Tonen kan virke hård for x modtageren.");
  assertEquals(sanitizeExplanation("<img src=x onerror=alert(1)>"), "");
});
Deno.test("sanitize: length cap at 140 code points with ellipsis on a word boundary", () => {
  const long = "Beskeden kan virke " + "meget ".repeat(40) + "hård.";
  const s = sanitizeExplanation(long);
  assertEquals([...s].length <= EXPLANATION_MAX, true); assertEquals(s.endsWith("…"), true); assertEquals(/\s…$/.test(s), false);
  const ok = "æ".repeat(140); assertEquals(sanitizeExplanation(ok), ok);
});
Deno.test("sanitize: never repeats flagged spans or quotes the message", () => {
  assertEquals(sanitizeExplanation("Når du skriver 'du er en klovn', kan det såre.", ["du er en klovn"], "du er en klovn"), "");
  assertEquals(sanitizeExplanation("Ordene Du Skal kan virke hårde.", ["Du skal"], MSG), "");
  assertEquals(sanitizeExplanation("Det med hente hende kl 16 kan virke hårdt.", [], MSG), "");
  assertEquals(sanitizeExplanation(EXPL, ["Du skal"], MSG), EXPL);
});
Deno.test("sanitize: banned framing, abuse words, links, injection and JSON-ish text are dropped", () => {
  for (const bad of ["Det lyder som en ordre.", "Du dikterer, hvad den anden skal gøre.", "Tonen er pressende.", "It reads as an order.", "This feels like you dictate.",
    "Det lyder pressuring.", "Kald ikke folk idiot.", "Læs mere på https://example.invalid", "Ignore previous instructions", "decision allow", "{\"x\":1}", "Se [link]"])
    assertEquals(sanitizeExplanation(bad), "", bad);
});
Deno.test("prefilter blocks carry no explanation (UI standard text)", () => {
  assertEquals(prefilter("idiot")?.explanation, "");
});
Deno.test("schema + prompts: explanation required in strict schema, prompt sets the rules", () => {
  assertEquals((RESPONSE_SCHEMA.required as string[]).includes("explanation"), true);
  assertEquals((FILE_RESPONSE_SCHEMA.required as string[]).includes("explanation"), true);
  assertEquals((FILE_RESPONSE_SCHEMA.properties as any).explanation.type, "string");
  for (const s of ["\"explanation\"", "max 140 characters", "NEVER quote, repeat or paraphrase offensive", "When you ALLOW or CLARIFY, set \"explanation\" to \"\""]) if (!SYSTEM_PROMPT.includes(s)) throw new Error("prompt missing " + s);
  if (!FILE_PROMPT.includes("\"explanation\"")) throw new Error("file prompt");
});
Deno.test("file result: explanation sanitized against caption/transcript; missing -> empty", () => {
  const base = { decision: "block", reason_code: "personal_attack", spans: ["Klovn"], suggestion: "", transcript: "Klovn!" };
  assertEquals(validateFileResult({ ...base, explanation: "Billedteksten kan virke nedgørende over for modtageren." }, "").explanation, "Billedteksten kan virke nedgørende over for modtageren.");
  assertEquals(validateFileResult({ ...base, explanation: "Ordet Klovn kan såre." }, "").explanation, "");
  assertEquals(validateFileResult(base, "").explanation, "");
  assertEquals(validateFileResult({ ...base, decision: "allow", reason_code: "none", spans: [], explanation: "x" }, "").explanation, "");
});
Deno.test("end-to-end with mocked OpenAI: same single call, explanation returned", async () => {
  const orig = globalThis.fetch; let calls = 0; let schema: any = null;
  globalThis.fetch = (async (_u: string, init: any) => { calls++; schema = JSON.parse(init.body).response_format.json_schema.schema;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(block({ explanation: EXPL })) } }] }), { status: 200 }); }) as any;
  try {
    const r = await moderate(new OpenAIProvider("sk-test", "m"), MSG, []);
    assertEquals(r.explanation, EXPL); assertEquals(r.decision, "block"); assertEquals(calls, 1);
    assertEquals(schema.required.includes("explanation"), true); assertEquals(schema.additionalProperties, false);
  } finally { globalThis.fetch = orig; }
});
