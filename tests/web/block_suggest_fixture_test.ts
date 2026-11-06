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
  assertStringIncludes(html, 'id="t"');
  assertStringIncludes(html, "ta.value = next");
  assertEquals(html.includes("onclick="), false, "prefer addEventListener over inline onclick");
});
