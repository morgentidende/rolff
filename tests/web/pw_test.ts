import { assertEquals } from "jsr:@std/assert@1";
import { passwordsMatch, pwText, toggleLabel } from "../../apps/web/src/pw.ts";
Deno.test("ens kodeord godkendes", () => assertEquals(passwordsMatch("hemmelig1", "hemmelig1"), true));
Deno.test("uens kodeord afvises", () => assertEquals(passwordsMatch("hemmelig1", "hemmelig2"), false));
Deno.test("tomme felter afvises", () => assertEquals(passwordsMatch("", ""), false));
Deno.test("forskel i store/små bogstaver afvises", () => assertEquals(passwordsMatch("Abc12345", "abc12345"), false));
Deno.test("øje-knappens label DA/EN", () => {
  assertEquals(toggleLabel("da", false), "Vis kodeord"); assertEquals(toggleLabel("da", true), "Skjul kodeord");
  assertEquals(toggleLabel("en", false), "Show password"); assertEquals(toggleLabel("en", true), "Hide password");
});
Deno.test("fejltekst findes på begge sprog", () => { for (const l of ["da", "en"] as const) assertEquals(pwText[l].mismatch.length > 10, true); });
