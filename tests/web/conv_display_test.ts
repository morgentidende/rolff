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

Deno.test("pending nickname wins over the invitee e-mail, keeps the waiting status and its own initial", () => {
  const d = convDisplay({ others: [], pending_invitee: "maya@test.invalid", pending_alias: "Far" }, true);
  assertEquals(d.title, "Far");
  assertEquals(d.status, "venter på accept");
  assertEquals(d.initial, "F");
  assertEquals(convDisplay({ others: [], pending_invitee: "maya@test.invalid", pending_alias: "Dad" }, false).status, "awaiting acceptance");
});

Deno.test("pending nickname works without an invitee e-mail (the 'Venter på den anden part' rows)", () => {
  const d = convDisplay({ others: [], pending_invitee: null, pending_alias: "Mor" }, true);
  assertEquals(d.title, "Mor");
  assertEquals(d.initial, "M");
});

Deno.test("blank pending nickname is ignored; accepted members use their own contact nickname only", () => {
  assertEquals(convDisplay({ others: [], pending_invitee: "maya@test.invalid", pending_alias: "   " }, true).title, "maya@test.invalid");
  assertEquals(convDisplay({ others: [], pending_invitee: null, pending_alias: "" }, true).title, "Venter på den anden part");
  // once somebody joined, the stale pending nickname is never shown; the carried-over contact nickname is
  const d = convDisplay({ others: [{ user_id: "1", email: "maya@test.invalid", alias: "Far" }], pending_invitee: null, pending_alias: "Gammelt" }, true);
  assertEquals(d.title, "Far");
  assertEquals(d.status, null);
});
