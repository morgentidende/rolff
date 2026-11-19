// Detailed tone-check explanations (19/11): name the concrete words, say whether the earlier conversation played a role,
// never quote the other person, never repeat swear words/slurs. Synthetic text, mocked model output, no network.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { EXPLANATION_DETAIL_MAX, moderate, OpenAIProvider, sanitizeExplanation, SYSTEM_PROMPT, systemPromptForLang, UNCERTAIN_EXPLANATION, validateResult, type ContextMsg, type ModerationProvider } from "../../supabase/functions/_shared/moderation.ts";

const MSG = "Det er jo typisk dig, at du glemmer det igen";
const CTX: ContextMsg[] = [{ mine: false, body: "Det har jeg sagt!" }, { mine: true, body: "En ret tydeligt irriteret besked, måske en regel omkring udråbstegn?" }];
const block = (o: Record<string, unknown> = {}) => ({ decision: "block", reason_code: "personal_attack", spans: ["typisk dig"], suggestion: "Kan du huske det næste gang?", explanation: "", ...o });
const DA = "Ordene „typisk dig“ og „glemmer det igen“ peger på noget, du altid gør, og kan få modtageren til at føle sig angrebet. Tidligere beskeder har ikke spillet en rolle.";
const DA_CTX = "Rolff er i tvivl om „nu hører jeg ikke mere“. Beskeden kan læses som et svar på en tidligere besked om udråbstegn og virke afvisende.";
const EN = "The words \"so typical of you\" point at something you always do and may make the recipient feel attacked. Earlier messages played no role.";

Deno.test("prompt asks for concrete words, the role of the earlier conversation, a Rolff-only voice and no quoting of the other person", () => {
  for (const p of [SYSTEM_PROMPT, systemPromptForLang("en")]) {
    for (const s of ["max 320 characters", "Name the concrete words or phrase of the NEW MESSAGE", "copied verbatim in quotation marks", "whether the earlier conversation played a role",
      "Tidligere beskeder har ikke spillet en rolle.", "Earlier messages played no role.", "Beskeden kan læses som et svar på en tidligere besked om udråbstegn.",
      "NEVER quote or paraphrase the other person's messages", "NEVER repeat slurs, swear words or threats", "never with a pronoun", "Rolff er i tvivl om", "Rolff isn't sure about"]) assert(p.includes(s), s);
    assert(!/luna|gpt|gemini|openai/i.test(p.replace(/OpenAI/g, "")), "no model/provider name in the prompt");
  }
});

Deno.test("detailed explanation naming the flagged words passes (da + en), up to 320 characters", () => {
  assertEquals(validateResult(block({ explanation: DA }), MSG, []).explanation, DA);
  assertEquals(validateResult(block({ spans: ["so typical of you"], explanation: EN }), "It's so typical of you to forget again", []).explanation, EN);
  assert([...DA].length <= EXPLANATION_DETAIL_MAX);
  const long = "Ordene „typisk dig“ kan virke hårde. " + "Det kan få modtageren til at føle sig dømt. ".repeat(12);
  const out = validateResult(block({ explanation: long }), MSG, []).explanation;
  assert([...out].length <= EXPLANATION_DETAIL_MAX && out.endsWith("…"));
});

Deno.test("the role of the earlier conversation can be stated by topic (uncertain block, mocked model)", () => {
  const r = validateResult({ decision: "block", reason_code: "uncertain", spans: ["nu hører jeg ikke mere"], suggestion: "Jeg har brug for en pause fra emnet.", explanation: DA_CTX }, "Det har du sagt før, så nu hører jeg ikke mere", CTX.map((c) => c.body));
  assertEquals(r.explanation, DA_CTX);
  assertEquals(r.reason_code, "uncertain");
});

Deno.test("the other person's messages are never quoted: a verbatim 4+ word run from the context drops the explanation", () => {
  const bad = "Beskeden svarer på „en ret tydeligt irriteret besked“ fra den anden og kan virke afvisende.";
  assertEquals(validateResult(block({ explanation: bad }), MSG, CTX.map((c) => c.body)).explanation, "");
  assertEquals(sanitizeExplanation("Beskeden svarer på en tidligere besked om udråbstegn.", [], MSG, { detail: true, context: CTX.map((c) => c.body) }), "Beskeden svarer på en tidligere besked om udråbstegn.");
});

Deno.test("swear words, slurs and over-long phrases are never repeated, even in detail mode", () => {
  assertEquals(sanitizeExplanation("Ordet lort kan såre.", ["lort"], "Sikke noget lort", { detail: true }), "");
  assertEquals(sanitizeExplanation("Ordet fuck kan såre.", ["fuck"], "fuck", { detail: true }), "");
  assertEquals(sanitizeExplanation("Ordet idiot kan såre.", ["idiot"], "idiot", { detail: true }), "");
  assertEquals(sanitizeExplanation("Frasen „du er altid så sur og gider aldrig noget“ er hård.", ["du er altid så sur og gider aldrig noget"], "du er altid så sur og gider aldrig noget", { detail: true }), "");
  assertEquals(sanitizeExplanation("Et ord i beskeden kan såre modtageren.", ["lort"], "Sikke noget lort", { detail: true }), "Et ord i beskeden kan såre modtageren.");
});

Deno.test("default (non-detail) sanitizer is unchanged: spans never appear, 140 characters", () => {
  assertEquals(sanitizeExplanation("Ordene typisk dig kan såre.", ["typisk dig"], MSG), "");
  assert([...sanitizeExplanation("æ".repeat(300))].length <= 140);
});

Deno.test("end to end with mocked OpenAI: detailed explanation, spans and suggestion are returned; context is sent but never quoted", async () => {
  const orig = globalThis.fetch; let user: any = null;
  globalThis.fetch = (async (_u: string, init: any) => {
    user = JSON.parse(JSON.parse(init.body).messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(block({ explanation: DA })) } }] }), { status: 200 });
  }) as any;
  try {
    const r = await moderate(new OpenAIProvider("sk-test", "m"), MSG, CTX);
    assertEquals(r.explanation, DA); assertEquals(r.spans, ["typisk dig"]); assertEquals(r.suggestion, "Kan du huske det næste gang?");
    assertEquals(user.new_message, MSG); assertEquals(user.context.length, 2);
  } finally { globalThis.fetch = orig; }
});

Deno.test("house-rule blocks stay short and deterministic (no model explanation is used)", async () => {
  const model: ModerationProvider = { name: "fake", model: "fake", moderate: () => Promise.resolve(block({ spans: ["lort"], reason_code: "other_harmful", explanation: DA })) };
  const r = await moderate(model, "Sikke noget lort at fyre af", []);
  assertEquals(r.source, "house");
  assertEquals(r.explanation, ""); // send-message replaces it with the fixed HOUSE_EXPLANATION line (PR92)
});

Deno.test("fixed Rolff uncertain text still exists as the fallback and names no model", () => {
  for (const t of Object.values(UNCERTAIN_EXPLANATION)) assert(t.startsWith("Rolff") && !/luna|gpt|gemini/i.test(t));
});
