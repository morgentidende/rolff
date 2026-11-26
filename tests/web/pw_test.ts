import { assertEquals } from "jsr:@std/assert@1";
import { passwordPairState, passwordsMatch, pwText, toggleLabel } from "../../apps/web/src/pw.ts";
Deno.test("ens kodeord godkendes", () => assertEquals(passwordsMatch("hemmelig1", "hemmelig1"), true));
Deno.test("uens kodeord afvises", () => assertEquals(passwordsMatch("hemmelig1", "hemmelig2"), false));
Deno.test("tomme felter afvises", () => assertEquals(passwordsMatch("", ""), false));
Deno.test("forskel i store/små bogstaver afvises", () => assertEquals(passwordsMatch("Abc12345", "abc12345"), false));
Deno.test("øje-knappens label DA/EN", () => {
  assertEquals(toggleLabel("da", false), "Vis kodeord"); assertEquals(toggleLabel("da", true), "Skjul kodeord");
  assertEquals(toggleLabel("en", false), "Show password"); assertEquals(toggleLabel("en", true), "Hide password");
});
Deno.test("gentag-label og ens/uens-tekst på begge sprog", () => {
  assertEquals(pwText.da.repeat, "Gentag adgangskode");
  assertEquals(pwText.en.repeat, "Repeat password");
  assertEquals(pwText.da.match, "Koderne er ens");
  assertEquals(pwText.en.match, "Passwords match");
  assertEquals(pwText.da.mismatch, "Koderne er ikke ens");
  assertEquals(pwText.en.mismatch, "Passwords do not match");
});
Deno.test("live status: tom indtil gentag-feltet har tekst, uafhængig af visning", () => {
  assertEquals(passwordPairState("hemmelig1", ""), "empty");
  assertEquals(passwordPairState("hemmelig1", "hemmelig1"), "match");
  assertEquals(passwordPairState("hemmelig1", "hemmelig2"), "mismatch");
  assertEquals(passwordPairState("", "x"), "mismatch");
});
