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

Deno.test("godkendelsesmail: ingen navne, e-mails eller beskedindhold", async () => {
  const { approvalMail, memberInviteMail } = await import("../../supabase/functions/_shared/email.ts");
  const m = approvalMail({ role: "reader", appUrl: "https://example.test/" });
  for (const part of [m.subject, m.html, m.text]) { if (/@/.test(part.replace(/rolff-128|example\.test/g, ""))) throw new Error("email leaked"); }
  if (!m.text.includes("kun læse")) throw new Error("role missing");
  const p = memberInviteMail({ inviterEmail: "a@x.test", link: "https://example.test/#invite=abc", expires: new Date().toISOString(), role: "writer" });
  if (!p.html.includes("læse og skrive") || !p.text.includes("#invite=abc")) throw new Error("bad member mail");
});

Deno.test("feedbackmail: escaping, kategori-whitelist, afsender", async () => {
  const { feedbackMail } = await import("../../supabase/functions/_shared/email.ts");
  const m = feedbackMail({ category: "x\r\nBcc: evil@x.test", body: "<script>alert(1)</script> & \"hej\"", senderName: "Mor <b>", senderId: "00000000-0000-0000-0000-000000000001" });
  if (m.subject !== "Rolff feedback: Andet" || /[\r\n]/.test(m.subject)) throw new Error("subject");
  if (m.html.includes("<script>") || !m.html.includes("&lt;script&gt;")) throw new Error("not escaped");
  if (!m.html.includes("Mor &lt;b&gt;") || !m.text.includes("00000000-0000-0000-0000-000000000001")) throw new Error("sender missing");
  if (feedbackMail({ category: "filter", body: "x", senderName: "a", senderId: "b" }).subject !== "Rolff feedback: Filter-feedback") throw new Error("cat");
});

Deno.test("reportMail escapes and includes only chosen messages", async () => {
  const { reportMail } = await import("../../supabase/functions/_shared/email.ts");
  const m = reportMail({ category: "child_safety", body: "<b>x</b>", senderName: "A", senderId: "u1", conversationId: "c1", messages: [{ sender_name: "B", body: "<script>", created_at: "t" }] });
  if (!m.subject.includes("Børns sikkerhed")) throw new Error("cat");
  if (m.html.includes("<script>") || m.html.includes("<b>x</b>")) throw new Error("escape");
  if (!m.text.includes("(1)")) throw new Error("count");
});
