// Invite sheet info: short bullets that keep every fact of the long note, da + en, no "hun eller han".
import { assert, assertEquals } from "jsr:@std/assert@1";
import { invitePoints } from "../../apps/web/src/inviteText.ts";

const all = (l: "da" | "en") => invitePoints(l).map((p) => `${p.lead ?? ""} ${p.text}`.trim()).join(" | ");

Deno.test("3-4 short bullets in both languages", () => {
  for (const l of ["da", "en"] as const) {
    const pts = invitePoints(l);
    assert(pts.length >= 3 && pts.length <= 4, `${l}: ${pts.length}`);
    for (const p of pts) assert(p.text.length <= 170, `${l} too long: ${p.text}`);
  }
});
Deno.test("da keeps every fact and uses 'vedkommende'", () => {
  const t = all("da");
  for (const f of ["dokumentation", "bliver hos de andre i samtalen", "også hvis du senere sletter din konto", "slette din egen kopi", "ikke kræve de andres slettet", "ser din e-mail", "privat kaldenavn", "kun de ser", "logger altid ind med din e-mail", "ny samtale mellem jer to", "kun beskeder fra efter, vedkommende er kommet med"]) assert(t.includes(f), f);
  assert(!/hun eller han/i.test(t));
  assert(invitePoints("da")[0].text.startsWith("Rolff kan bruges som dokumentation"), "most important first");
});
Deno.test("en keeps every fact", () => {
  const t = all("en");
  for (const f of ["used as a record", "stays with the others in the conversation", "even if you later delete your account", "delete your own copy", "cannot require the others' copy to be deleted", "see your email", "private nickname", "only they see", "always log in with your email", "new conversation is created for the two of you", "only sees messages from after joining"]) assert(t.includes(f), f);
  assertEquals(invitePoints("en")[0].lead, "Important:");
});
