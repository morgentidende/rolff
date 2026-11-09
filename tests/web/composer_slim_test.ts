import { assert } from "jsr:@std/assert@1";
const css = Deno.readTextFileSync("apps/web/src/styles.css");
const luna = Deno.readTextFileSync("apps/web/src/lunaRobot.css");
const tsx = Deno.readTextFileSync("apps/web/src/ComposerInput.tsx");
Deno.test("counter adds no row: floats, and is screen-reader-only below 80 %", () => {
  assert(tsx.includes("COUNT_SHOW_AT = 0.8") && tsx.includes('" is-quiet"'));
  assert(/\.composer-count\{position:absolute;[^}]*bottom:100%/.test(css));
  assert(/\.composer-count\.is-quiet\{[^}]*clip-path:inset\(50%\)/.test(css));
});
Deno.test("approval/checking never grow the composer", () => {
  assert(/\.luna-in-composer\.luna-done\{position:absolute;/.test(luna), "happy robot takes no layout space");
  assert(/\.composer-entry\{position:relative;/.test(css));
  assert(/\.composer-entry\.is-checking\{padding:2px 4px;min-height:48px\}/.test(css), "checking matches idle height");
  assert(/\.luna-check-text\{[^}]*white-space:nowrap;text-overflow:ellipsis/.test(luna), "pending text is one line");
});
