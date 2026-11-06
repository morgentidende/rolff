import { assertEquals } from "jsr:@std/assert@1";
import { convDisplay } from "../../apps/web/src/convDisplay.ts";

Deno.test("pending invite shows invitee email and M initial, not V", () => {
  const d = convDisplay({ others: [], pending_invitee: "maya@test.invalid" }, true);
  assertEquals(d.title, "maya@test.invalid");
  assertEquals(d.status, "venter på accept");
  assertEquals(d.initial, "M");
});

Deno.test("no invitee falls back without inventing an identity", () => {
  const d = convDisplay({ others: [], pending_invitee: null }, true);
  assertEquals(d.title, "Venter på den anden part");
  assertEquals(d.initial, "?");
  assertEquals(d.status, "venter på accept");
});

Deno.test("joined members show names and no status", () => {
  const d = convDisplay({ others: [{ user_id: "1", email: "maya@test.invalid", alias: "Maya" }], pending_invitee: "maya@test.invalid" }, true);
  assertEquals(d.title, "Maya");
  assertEquals(d.status, null);
  assertEquals(d.initial, "M");
});
