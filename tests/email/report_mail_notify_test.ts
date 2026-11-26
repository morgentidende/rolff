// Report inbox lookup and mail content. No real e-mail is sent: env is faked and sendMail is not called against a network here.
import { assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
const E = await import("../../supabase/functions/_shared/email.ts");

Deno.test("REPORT_EMAIL_TO wins over FEEDBACK_TO; invalid or missing yields null", () => {
  Deno.env.delete("REPORT_EMAIL_TO"); Deno.env.delete("FEEDBACK_TO");
  assertEquals(E.reportRecipient(), null);
  Deno.env.set("FEEDBACK_TO", "old@example.test");
  assertEquals(E.reportRecipient(), "old@example.test");
  Deno.env.set("REPORT_EMAIL_TO", "nicolaipetersen108@gmail.com");
  assertEquals(E.reportRecipient(), "nicolaipetersen108@gmail.com");
  Deno.env.set("REPORT_EMAIL_TO", "not-an-email");
  assertEquals(E.reportRecipient(), "old@example.test", "invalid REPORT_EMAIL_TO falls back");
  Deno.env.set("REPORT_EMAIL_TO", "evil@x.test\nBcc: x@y.test");
  assertEquals(E.reportRecipient(), "old@example.test");
  Deno.env.delete("REPORT_EMAIL_TO"); Deno.env.delete("FEEDBACK_TO");
});

Deno.test("reportMail includes report id, reporter, reported user, conversation, reason, message and timestamp; HTML is escaped", () => {
  const at = "2026-11-26T08:00:00.000Z";
  const m = E.reportMail({
    category: "harassment",
    body: "Se <img src=x>",
    reportId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    reporterId: "11111111-1111-4111-8111-111111111111",
    reporterEmail: "reporter@example.test",
    conversationId: "22222222-2222-4222-8222-222222222222",
    messages: [{
      sender_id: "33333333-3333-4333-8333-333333333333",
      sender_email: 'bad@x.test">',
      body: "<script>alert(1)</script>",
      created_at: at,
    }],
  });
  assertEquals(m.subject, "Rolff rapport: Chikane/trusler");
  for (const part of [m.html, m.text]) {
    if (!part.includes("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")) throw new Error("report id");
    if (!part.includes("11111111-1111-4111-8111-111111111111")) throw new Error("reporter id");
    if (!part.includes("reporter@example.test")) throw new Error("reporter email");
    if (!part.includes("33333333-3333-4333-8333-333333333333")) throw new Error("reported id");
    if (!part.includes("22222222-2222-4222-8222-222222222222")) throw new Error("conversation");
    if (!part.includes("Chikane/trusler")) throw new Error("category");
  }
  if (m.html.includes("<script>") || m.html.includes("<img src=x>") || m.html.includes('bad@x.test">')) throw new Error("unescaped html");
  if (!m.html.includes("&lt;script&gt;") || !m.html.includes("&lt;img src=x&gt;") || !m.html.includes("&quot;")) throw new Error("escape missing");
  if (!m.text.includes("<script>alert(1)</script>") || !m.text.includes("Se <img src=x>")) throw new Error("plain text keeps raw content");
});
