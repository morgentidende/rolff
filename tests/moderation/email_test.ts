import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
const { inviteMail, copyMail } = await import("../../supabase/functions/_shared/email.ts");
const exp = new Date(Date.now() + 3600e3).toISOString();
for (const [name, m] of [["invitation", inviteMail({ inviterEmail: "a@x.test", link: "https://example.test/#invite=abc", expires: exp })],
  ["kopi", copyMail({ inviteeEmail: "b@x.test", expires: exp })]] as const) {
  Deno.test(`${name}: logo via absolut https-URL med alt-tekst og baggrundsfarve`, () => {
    assert(m.html.includes('src="https://example.test/icons/rolff-128.png"'));
    assert(m.html.includes('alt="Rolff logo"'));
    assert(m.html.includes('bgcolor="#016C72"'));
    assert(m.text.length > 20);
  });
}
Deno.test("kopi indeholder ikke invitationslinket", () => {
  const c = copyMail({ inviteeEmail: "b@x.test", expires: exp });
  assertEquals(c.html.includes("#invite="), false);
});
Deno.test("ingen modtagernavn/kaldenavn i mails; afsender vises som e-mail", () => {
  const i = inviteMail({ inviterEmail: "a@x.test", link: "https://example.test/#invite=abc", expires: exp });
  assert(i.subject.startsWith("a@x.test har inviteret dig")); assert(i.html.startsWith("<!doctype") && i.html.includes("Hej,"));
});
