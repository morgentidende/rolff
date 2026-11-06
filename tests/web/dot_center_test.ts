/**
 * Regression: avatar letter must be centered inside the teal circle.
 * Root cause (Nov 2026): `.list button { text-align:left }` hit `button.dot`, and
 * `display:flex` on a <button> does not center its children in Chromium/WebKit
 * (UA anonymous box). Fix = exclude the dot from the list rule + center via
 * absolutely positioned inner span.
 */
import { assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";

const root = new URL("../..", import.meta.url);
const css = await Deno.readTextFile(new URL("apps/web/src/styles.css", root));
const app = await Deno.readTextFile(new URL("apps/web/src/App.tsx", root));
const fixture = await Deno.readTextFile(new URL("apps/web/public/avatar-fixture.html", root));

Deno.test("list rule targets .convbtn only — not every button (incl. .dot)", () => {
  assertMatch(css, /\.list\s+\.convbtn\s*\{[^}]*text-align\s*:\s*left/);
  // The old buggy selector must stay gone.
  assertEquals(/\.list\s+button\s*\{/.test(css), false, ".list button{ still present — hits avatar");
});

Deno.test("button.dot centers via absolute inner span (not flex-on-button alone)", () => {
  assertMatch(css, /button\.dot\s*\{[^}]*position\s*:\s*relative/);
  assertMatch(css, /button\.dot\s*\{[^}]*text-align\s*:\s*center/);
  assertMatch(css, /button\.dot\s*>\s*span\s*\{[^}]*position\s*:\s*absolute/);
  assertMatch(css, /button\.dot\s*>\s*span\s*\{[^}]*inset\s*:\s*0/);
  assertMatch(css, /button\.dot\s*>\s*span\s*\{[^}]*display\s*:\s*flex/);
  assertMatch(css, /button\.dot\s*>\s*span\s*\{[^}]*justify-content\s*:\s*center/);
  assertMatch(css, /button\.dot\s*>\s*span\s*\{[^}]*align-items\s*:\s*center/);
  // Must not claim centering only via flex on the button itself as the sole method.
  const dotRule = css.match(/button\.dot\s*\{[^}]+\}/)?.[0] ?? "";
  assertEquals(/display\s*:\s*inline-flex/.test(dotRule), false, "flex-on-button alone is the buggy pattern");
});

Deno.test("ColorDot markup: button.dot > span with the letter", () => {
  assertMatch(app, /className=\{`dot c-\$\{color\}`\}/);
  assertMatch(app, /<span aria-hidden="true">\{letter\}<\/span>/);
});

Deno.test("public avatar-fixture mirrors DOM + critical CSS from styles.css", () => {
  assertStringIncludes(fixture, 'class="dot c-teal"');
  assertStringIncludes(fixture, '<span aria-hidden="true">M</span>');
  assertStringIncludes(fixture, 'class="convrow"');
  assertStringIncludes(fixture, 'class="convbtn"');
  assertStringIncludes(fixture, "maya@example.test");
  // Critical rules must be copied from the live stylesheet (string-equal excerpts).
  for (const re of [
    /button\.dot\s*\{[^}]+\}/,
    /button\.dot\s*>\s*span\s*\{[^}]+\}/,
    /\.list\s+\.convbtn\s*\{[^}]+\}/,
  ]) {
    const live = css.match(re)?.[0];
    if (!live) throw new Error(`missing in styles.css: ${re}`);
    assertStringIncludes(fixture, live, `fixture CSS out of sync: ${re}`);
  }
});
