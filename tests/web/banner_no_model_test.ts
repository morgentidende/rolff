// The test-version banner never names the AI model, but still says it is a test version and warns about real/sensitive data.
import { assert } from "jsr:@std/assert@1";
import { strings } from "../../apps/web/src/i18n.ts";
Deno.test("demoWarn (da/en) has no model name and keeps the warning", () => {
  for (const lang of ["da", "en"] as const) {
    const t = strings[lang].demoWarn;
    assert(!/gpt|luna|gemini|claude|\bo[0-9]\b|model/i.test(t), `${lang}: ${t}`);
  }
  assert(/^Testversion: Skriv ikke rigtige eller følsomme oplysninger\./.test(strings.da.demoWarn));
  assert(/^Test version: Do not enter real or sensitive information\./.test(strings.en.demoWarn));
});
