import { assertEquals } from "jsr:@std/assert@1";
import { eventText } from "../../apps/web/src/eventText.ts";
const base = { id: "e1", created_at: "2026-11-09T15:00:00Z" };
Deno.test("email change notice follows the viewer's app language; X is alias/old e-mail, Y the new e-mail", () => {
  const e = { ...base, kind: "email_changed", actor_label: "Bs navn for A", mine: false, new_label: "new@example.invalid" };
  assertEquals(eventText(e, true), "Bs navn for A har skiftet e-mail til new@example.invalid");
  assertEquals(eventText(e, false), "Bs navn for A changed their e-mail to new@example.invalid");
  assertEquals(eventText({ ...e, mine: true }, true), "Du har skiftet e-mail til new@example.invalid");
  assertEquals(eventText({ ...e, mine: true }, false), "You changed your e-mail to new@example.invalid");
  assertEquals(eventText({ ...e, new_label: null }, true), "");
});
Deno.test("export notice unchanged", () => {
  assertEquals(eventText({ ...base, kind: "export", actor_label: "a@x", mine: false }, true), "a@x har lavet en udskrift af samtalen");
});
