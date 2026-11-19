import { assertEquals } from "jsr:@std/assert@1";
import { flaggedSnippet } from "../../apps/web/src/flaggedSnippet.ts";
Deno.test("snippet: short text is shown whole, no ellipsis", () => {
  assertEquals(flaggedSnippet("Det har jeg sagt!", ["!"]), { pre: "Det har jeg sagt", hit: "!", post: "" });
  assertEquals(flaggedSnippet("Sikke noget lort at fyre af", ["lort"]), { pre: "Sikke noget ", hit: "lort", post: " at fyre af" });
});
Deno.test("snippet: long text is cut at word boundaries with ellipses and keeps the marked word", () => {
  const t = "Jeg har ventet rigtig længe på svar fra dig og nu er det helt og aldeles lort at høre på hele tiden, hver eneste dag i ugen";
  const s = flaggedSnippet(t, ["lort"])!;
  assertEquals(s.hit, "lort");
  assertEquals(s.pre.startsWith("…") && s.post.endsWith("…"), true);
  for (const part of [s.pre.slice(1), s.post.slice(0, -1)]) for (const w of part.split(" ").filter(Boolean)) assertEquals(t.includes(w), true);
  assertEquals(t.includes(s.pre.slice(1) + s.hit + s.post.slice(0, -1)), true);
});
Deno.test("snippet: no usable span -> null", () => {
  assertEquals(flaggedSnippet("Hej", []), null);
  assertEquals(flaggedSnippet("Hej", ["", "xyz"]), null);
});
