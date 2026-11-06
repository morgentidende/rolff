import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
const html = await Deno.readTextFile(new URL("../../apps/web/public/block-suggest-fixture.html", import.meta.url));
Deno.test("fixture prevents mobile overflow basics", () => {
  assertStringIncludes(html, "box-sizing:border-box");
  assertStringIncludes(html, "overflow-x:hidden");
  assertStringIncludes(html, "overflow-wrap:anywhere");
  assertStringIncludes(html, "width:100%");
});
Deno.test("fixture wires Brug forslaget click (not a dead button)", () => {
  assertStringIncludes(html, 'id="use"');
  assertStringIncludes(html, "addEventListener(\"click\"");
  assertStringIncludes(html, 'id="t-can"');
  assertStringIncludes(html, "ta.value = next");
  assertEquals(html.includes("onclick="), false, "prefer addEventListener over inline onclick");
});
Deno.test("fixture shows both rewritable and non-rewritable states", () => {
  assertStringIncludes(html, "Kan omformuleres");
  assertStringIncludes(html, "Kan ikke omformuleres");
  assertStringIncludes(html, "Vejledning");
  assertStringIncludes(html, "Skriv, hvad der skete, og hvad du gerne vil have anderledes – uden at kritisere den anden.");
  assertStringIncludes(html, "Du er altid så sur");
  // Guidance section must not have a use-suggestion button targeting the pure-criticism textarea
  assertStringIncludes(html, 'id="t-cannot"');
  assertEquals(/id="use"[^>]*>[\s\S]*id="t-cannot"/.test(html) && html.includes('aria-controls="t-cannot"'), false);
});
