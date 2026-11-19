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
  for (const f of ["dokumentation", "bliver hos de andre i samtalen", "også hvis du senere sletter din konto", "slette din egen kopi", "ikke kræve de andres slettet", "ser din e-mail", "logger altid ind med din e-mail", "ny samtale mellem jer to", "kun beskeder fra efter, vedkommende er kommet med"]) assert(t.includes(f), f);
  assert(!/hun eller han/i.test(t));
  assert(invitePoints("da")[0].text.startsWith("Rolff kan bruges som dokumentation"), "most important first");
});
Deno.test("en keeps every fact", () => {
  const t = all("en");
  for (const f of ["used as a record", "stays with the others in the conversation", "even if you later delete your account", "delete your own copy", "cannot require the others' copy to be deleted", "see your email", "always log in with your email", "new conversation is created for the two of you", "only sees messages from after joining"]) assert(t.includes(f), f);
  assertEquals(invitePoints("en")[0].lead, "Important:");
});
Deno.test("bullet 4 no longer mentions the private nickname (da + en)", () => {
  assertEquals(invitePoints("da")[3].text, "De andre i samtalen ser din e-mail. Du logger altid ind med din e-mail.");
  assertEquals(invitePoints("en")[3].text, "The others in the conversation see your email. You always log in with your email.");
  for (const l of ["da", "en"] as const) assert(!/kaldenavn|nickname/i.test(all(l)), l);
});
