// Password reset, e-mail change, inactivity warning and export receipt follow da/en (default da).
// Templates only; no mail is sent and no provider is called.
import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
import {
  emailChangeMail, exportMail, exportNoticeMail, inactivityMail, mailLang, preferLang, recoveryMail, storedLang,
} from "../../supabase/functions/_shared/email.ts";

Deno.test("preferLang: first explicit da|en wins, else da", () => {
  assertEquals(preferLang("en", "da"), "en");
  assertEquals(preferLang(undefined, "en"), "en");
  assertEquals(preferLang("fr", null, "da"), "da");
  assertEquals(preferLang(), "da");
  assertEquals(mailLang("en"), "en");
});

Deno.test("storedLang: uses locale_of / locale_for_email and falls back to da", async () => {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "locale_of" && args.p_uid === "u-en") return { data: "en" };
    if (name === "locale_for_email" && args.p_email === "a@x.test") return { data: "en" };
    if (name === "locale_of" && args.p_uid === "boom") throw new Error("missing");
    return { data: null };
  };
  assertEquals(await storedLang(rpc, { uid: "u-en" }), "en");
  assertEquals(await storedLang(rpc, { email: "a@x.test" }), "en");
  assertEquals(await storedLang(rpc, { email: "nobody@x.test" }), "da");
  assertEquals(await storedLang(rpc, { uid: "boom" }), "da");
  assertEquals(await storedLang(rpc, {}), "da");
});

const link = "https://example.test/?auth=recovery&th=ab";
const exportArgs = { exporterEmail: "a@x.test", toSelf: true, verifyUrl: "https://example.test/tjek.html?k=1", code: "ABCD-EF01", exportId: "eeeeeeee-0000-4000-8000-000000000001", scope: "Hele samtalen", count: 4, pages: 2 };

function assertEn(m: { subject: string; html: string; text: string }, subj: string) {
  assertEquals(m.subject, subj);
  assert(m.html.startsWith('<!doctype html><html lang="en">'), m.html.slice(0, 80));
  assert(m.html.includes("Hi,") && !m.html.includes("Hej,"));
  assert(m.html.includes("This is a test version of Rolff"));
  assert(!/Nulstil|adgangskode|udskrift|inaktivitet|Bekræft|slettes snart|Log ind/.test(m.html.replace(/<em>.*?<\/em>|<strong>Testversion\.<\/strong>[^<]*/gs, "")), m.subject);
}

Deno.test("English: recovery, e-mail change, inactivity and export receipts", () => {
  assertEn(recoveryMail({ link, lang: "en" }), "Reset your Rolff password");
  assert(recoveryMail({ link, lang: "en" }).text.includes(link));
  assertEn(emailChangeMail({ link: "", current: true, newEmail: "n@x.test", lang: "en" }), "Your e-mail in Rolff is about to be changed");
  assert(!emailChangeMail({ link: "", current: true, newEmail: "<x>@y.dk", lang: "en" }).html.includes("<x>"));
  const confirm = emailChangeMail({ link, current: false, newEmail: "n@x.test", lang: "en" });
  assertEn(confirm, "Confirm your new e-mail in Rolff");
  assert(confirm.text.includes(link) && confirm.html.includes("Confirm"));
  assertEn(inactivityMail({ link: "https://example.test/", lang: "en" }), "Your Rolff account will be deleted soon due to inactivity");
  assert(inactivityMail({ link: "https://example.test/", lang: "en" }).text.includes("14 days"));
  const self = exportMail({ ...exportArgs, lang: "en", scope: "The whole conversation" });
  assertEn(self, "Your transcript of the conversation from Rolff");
  assert(self.html.includes("Check transcript") && self.html.includes("4 messages"));
  const other = exportMail({ ...exportArgs, toSelf: false, lang: "en", scope: "The whole conversation" });
  assertEn(other, "a@x.test has sent you a transcript of a conversation from Rolff");
  assertEn(exportNoticeMail({ recipient: "b@x.test", exportId: exportArgs.exportId, scope: "The whole conversation", count: 4, lang: "en" }), "Rolff: You have sent a transcript of a conversation");
});

Deno.test("Danish remains the default and matches explicit da", () => {
  for (const [da, en] of [
    [recoveryMail({ link }), recoveryMail({ link, lang: "da" })],
    [inactivityMail({ link: "https://x" }), inactivityMail({ link: "https://x", lang: "da" })],
    [emailChangeMail({ link, current: false, newEmail: "n@x.test" }), emailChangeMail({ link, current: false, newEmail: "n@x.test", lang: "da" })],
    [exportMail(exportArgs), exportMail({ ...exportArgs, lang: "da" })],
  ] as const) assertEquals(JSON.stringify(da), JSON.stringify(en));
  const r = recoveryMail({ link });
  assert(r.html.startsWith('<!doctype html><html lang="da">'));
  assertEquals(r.subject, "Nulstil din adgangskode til Rolff");
  assert(inactivityMail({ link: "https://x" }).text.includes("14 dage"));
  assertEquals(exportMail(exportArgs).subject, "Din udskrift af samtalen fra Rolff");
});

Deno.test("garbage lang falls back to Danish", () => {
  assertEquals(recoveryMail({ link, lang: "fr" as any }).subject, recoveryMail({ link }).subject);
  assertEquals(inactivityMail({ link: "https://x", lang: "EN" as any }).subject, inactivityMail({ link: "https://x" }).subject);
});
