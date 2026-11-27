// The test-version banner and signup consent never name the AI provider or model,
// but still say it is a test version and warn about real/sensitive data.
import { assert } from "jsr:@std/assert@1";
import { strings } from "../../apps/web/src/i18n.ts";

const FORBIDDEN = /gpt|luna|gemini|claude|openai|chatgpt|grok|\bo[0-9]\b|\bmodel\b|store:false/i;

Deno.test("demoWarn (da/en) has no provider or model name and keeps the warning", () => {
  for (const lang of ["da", "en"] as const) {
    const t = strings[lang].demoWarn;
    assert(!FORBIDDEN.test(t), `${lang}: ${t}`);
  }
  assert(/^Testversion: Skriv ikke rigtige eller følsomme oplysninger\./.test(strings.da.demoWarn));
  assert(/^Test version: Do not enter real or sensitive information\./.test(strings.en.demoWarn));
  assert(/Beskeder tjekkes før de sendes/.test(strings.da.demoWarn));
  assert(/Messages are checked before they are sent/.test(strings.en.demoWarn));
});

Deno.test("signup AI consent (da/en) has no provider or model name", () => {
  for (const lang of ["da", "en"] as const) {
    const t = strings[lang].ai;
    assert(!FORBIDDEN.test(t), `${lang}: ${t}`);
  }
  assert(/en AI-tjeneste/.test(strings.da.ai));
  assert(/an AI service/.test(strings.en.ai));
  assert(/30 dage til misbrugskontrol/.test(strings.da.ai));
  assert(/30 days for abuse monitoring/.test(strings.en.ai));
  assert(!/gemning slået fra|storage turned off/.test(strings.da.ai + strings.en.ai));
});
