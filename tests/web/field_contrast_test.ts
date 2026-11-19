// Text fields and the chat composer need a border with >= 3:1 contrast (WCAG 1.4.11) in light and dark theme.
import { assert } from "jsr:@std/assert@1";
const css = Deno.readTextFileSync(new URL("../../apps/web/src/styles.css", import.meta.url));
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Last definition of a token for a theme wins (later rules override earlier ones), like in the browser.
function token(theme: "light" | "dark", name: string): string {
  const re = new RegExp(`${theme === "dark" ? "\\[data-theme=dark\\]" : ":root"}\\{([^}]*)\\}`, "g");
  let v = ""; for (const m of css.matchAll(re)) { const d = m[1].match(new RegExp(`--${name}:(#[0-9a-fA-F]{3,6})\\b`)); if (d) v = d[1].length === 4 ? "#" + [...d[1].slice(1)].map((c) => c + c).join("") : d[1]; }
  assert(v, `${theme} --${name}`); return v;
}
for (const theme of ["light", "dark"] as const) {
  Deno.test(`${theme}: field border >= 3:1 against every surface it sits on`, () => {
    const border = token(theme, "field-border");
    for (const s of ["bg", "card", "field-bg", "composer-surface", "composer-focus"]) assert(ratio(border, token(theme, s)) >= 3, `${theme} border vs ${s}: ${ratio(border, token(theme, s)).toFixed(2)}`);
  });
}
Deno.test("composer has a visible border and a teal focus state; inputs use the shared tokens", () => {
  assert(/\.composer-entry\{[^}]*border:1\.5px solid var\(--field-border\)/.test(css));
  assert(/\.composer-entry:focus-within\{[^}]*border-color:var\(--field-focus\)/.test(css));
  assert(/^input,select,textarea\{[^}]*border:1px solid var\(--field-border\);background:var\(--field-bg\)/m.test(css));
});
