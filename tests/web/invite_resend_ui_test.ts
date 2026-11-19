// Pending-invitation UI: resend, copy link, expired, mail failure. da + en, only "Rolff" as the assistant name.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { invActions, invText, type PendingInv } from "../../apps/web/src/inviteText.ts";
const base: PendingInv = { id: "i", role: "parent", invitee_email: "far@x.test", consents: 1, required: 1, i_consented: true, mine: true, expired: false, mail_failed: false, can_manage: true };

Deno.test("approved invitation: parent can resend and copy link; withdraw stays available", () => {
  assertEquals(invActions(base), { resend: true, copyLink: true, remove: false, approve: false, withdraw: true });
});
Deno.test("not fully approved: no resend/copy; approver sees approve", () => {
  const a = invActions({ ...base, consents: 1, required: 2, i_consented: false, mine: false });
  assertEquals([a.resend, a.copyLink, a.approve], [false, false, true]);
});
Deno.test("expired: marked removable, renewable when approved, never approvable", () => {
  assertEquals(invActions({ ...base, expired: true }), { resend: true, copyLink: true, remove: true, approve: false, withdraw: false });
  assertEquals(invActions({ ...base, expired: true, consents: 1, required: 2, i_consented: false }).approve, false);
});
Deno.test("non-parent members cannot resend, copy or remove", () => {
  const a = invActions({ ...base, can_manage: false, expired: true });
  assertEquals([a.resend, a.copyLink, a.remove], [false, false, false]);
});
Deno.test("texts exist in da and en with the same keys and required labels", () => {
  const da = invText("da"), en = invText("en");
  assertEquals(Object.keys(da).sort(), Object.keys(en).sort());
  assertEquals([da.resend, da.copyLink, da.expired], ["Send igen", "Kopiér invitationslink", "Udløbet"]);
  assertEquals([en.resend, en.copyLink, en.expired], ["Send again", "Copy invitation link", "Expired"]);
  for (const t of [da, en]) for (const v of Object.values(t)) {
    const s = typeof v === "function" ? (v as (w: string) => string)("x@y.z") : v;
    assert(!/Luna|OpenAI|Gemini|GPT|\bhun\b|\bhan\b|\bshe\b|\bhe\b/i.test(s), s);
  }
  assertEquals(invText("fr" as "da").resend, "Send igen");
});
Deno.test("App wires resend, link, remove and shows mail failures", async () => {
  const src = await Deno.readTextFile(new URL("../../apps/web/src/App.tsx", import.meta.url));
  assert(src.includes('callFn("invite-email", { action: kind, invitation_id: id, lang })'));
  assert(src.includes('supabase.rpc("revoke_invitation", { inv: id })'));
  assert(src.includes("navigator.clipboard.writeText(link)"));
  assert(src.includes("invText(lang).createdMailFailed") && src.includes("invText(lang).approvedMailFailed") && src.includes("invText(lang).sendFailed"));
  assert(src.includes("iv.mail_failed") && src.includes("tx.expired"));
});
