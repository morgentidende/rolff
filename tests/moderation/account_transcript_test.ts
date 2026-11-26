// Pre-delete transcript + delete-account order. Mocks only: no real mail, auth or network.
import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
import { accountTranscriptMail } from "../../supabase/functions/_shared/email.ts";
import { buildTranscriptHtml, sendAccountTranscript } from "../../supabase/functions/_shared/accountTranscript.ts";
import { runDeleteAccount } from "../../supabase/functions/_shared/deleteAccount.ts";

Deno.test("transcript HTML escapes content and lists every conversation", () => {
  const html = buildTranscriptHtml([
    { id: "c1", title: "Mor <b> & 'Bo'", messages: [{ created_at: "2026-11-09T12:00:00Z", mine: true, body: "<script>alert(1)</script>" }, { created_at: "2026-11-09T12:01:00Z", mine: false, sender_name: "Bo", body: "Hej", file_name: "skema.pdf" }] },
    { id: "c2", title: "Tom", messages: [] },
  ], { generatedAt: "2026-11-26T12:00:00Z", lang: "da" });
  assert(html.includes("<html lang=\"da\">"));
  assert(html.includes("Udskrift af dine samtaler i Rolff"));
  assert(html.includes("Mor &lt;b&gt; &amp; &#39;Bo&#39;"));
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert(!html.includes("<script>"));
  assert(html.includes("Vedhæftet: skema.pdf"));
  assert(html.includes("Ingen beskeder."));
});

Deno.test("sendAccountTranscript mails an HTML attachment and never puts message text in the body", async () => {
  const sent: any[] = [];
  const ok = await sendAccountTranscript({ email: "me@x.test", lang: "da" }, {
    listConversations: async () => ({ data: [{ id: "20000000-0000-4000-8000-000000000001", others: [{ email: "anden@x.test", alias: "Anden" }] }], error: null }),
    getMessages: async () => ({ data: [{ created_at: "2026-11-09T12:00:00Z", mine: true, body: "HEMMELIG-TESTBESKED" }], error: null }),
    mail: async (to, m) => { sent.push({ to, ...m }); return true; },
  });
  assert(ok);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "me@x.test");
  assertEquals(sent[0].subject, "Din udskrift af alle dine samtaler i Rolff");
  assert(!sent[0].html.includes("HEMMELIG-TESTBESKED"));
  assert(!sent[0].text.includes("HEMMELIG-TESTBESKED"));
  const a = sent[0].attachments[0];
  assertEquals(a.filename.startsWith("rolff-udskrift-"), true);
  assertEquals(a.content_type, "text/html");
  assert(atob(a.content_b64).includes("HEMMELIG-TESTBESKED"));
  assert(atob(a.content_b64).includes("Anden"));
});

Deno.test("sendAccountTranscript fails closed when listing or mail fails", async () => {
  const failList = await sendAccountTranscript({ email: "me@x.test" }, {
    listConversations: async () => ({ data: null, error: { message: "boom" } }),
    getMessages: async () => ({ data: [], error: null }),
    mail: async () => true,
  });
  assertEquals(failList, false);
  const failMail = await sendAccountTranscript({ email: "me@x.test" }, {
    listConversations: async () => ({ data: [], error: null }),
    getMessages: async () => ({ data: [], error: null }),
    mail: async () => false,
  });
  assertEquals(failMail, false);
});

function deps(log: string[], opts: { pwOk?: boolean; mailOk?: boolean; purgeOk?: boolean; authOk?: boolean } = {}) {
  const pwOk = opts.pwOk ?? true, mailOk = opts.mailOk ?? true, purgeOk = opts.purgeOk ?? true, authOk = opts.authOk ?? true;
  return {
    getEmail: async () => "me@x.test",
    checkPassword: async (_e: string, pw: string) => { log.push("check"); return pwOk && pw === "hemmelig1"; },
    sendTranscript: async () => { log.push("mail"); return mailOk; },
    purge: async () => { log.push("purge"); return purgeOk; },
    deleteAuth: async () => { log.push("auth"); return authOk; },
  };
}

Deno.test("delete-account: transcript is sent before purge; mail failure aborts deletion", async () => {
  const okLog: string[] = [];
  const ok = await runDeleteAccount({ password: "hemmelig1", email_transcript: true, lang: "da" }, deps(okLog));
  assertEquals(ok, { status: 200, body: { data: { deleted: true, transcript_sent: true } } });
  assertEquals(okLog, ["check", "mail", "purge", "auth"]);

  const failLog: string[] = [];
  const fail = await runDeleteAccount({ password: "hemmelig1", email_transcript: true }, deps(failLog, { mailOk: false }));
  assertEquals(fail, { status: 502, body: { error: "export_failed" } });
  assertEquals(failLog, ["check", "mail"]);

  const skipLog: string[] = [];
  const skip = await runDeleteAccount({ password: "hemmelig1", email_transcript: false }, deps(skipLog));
  assertEquals(skip.status, 200);
  assertEquals(skip.body, { data: { deleted: true, transcript_sent: false } });
  assertEquals(skipLog, ["check", "purge", "auth"]);
});

Deno.test("delete-account: wrong password never mails or deletes; missing flag skips transcript", async () => {
  const log: string[] = [];
  const wrong = await runDeleteAccount({ password: "forkert", email_transcript: true }, deps(log, { pwOk: false }));
  assertEquals(wrong, { status: 403, body: { error: "wrong_password" } });
  assertEquals(log, ["check"]);
  const none: string[] = [];
  const plain = await runDeleteAccount({ password: "hemmelig1" }, deps(none));
  assertEquals(plain.status, 200);
  assertEquals(none, ["check", "purge", "auth"]);
});

Deno.test("accountTranscriptMail is bilingual and has no message content or provider names", () => {
  const da = accountTranscriptMail({ conversations: 2, messages: 5 });
  const en = accountTranscriptMail({ conversations: 2, messages: 5, lang: "en" });
  assertEquals(da.subject, "Din udskrift af alle dine samtaler i Rolff");
  assertEquals(en.subject, "Your transcript of all your Rolff conversations");
  assert(da.html.startsWith("<!doctype html><html lang=\"da\">"));
  assert(en.html.startsWith("<!doctype html><html lang=\"en\">"));
  assert(en.html.includes("Hi,") && !en.html.includes("Hej,"));
  for (const m of [da, en]) {
    assert(!/OpenAI|GPT-|Anthropic|Gemini|Luna/i.test(m.html + m.text + m.subject));
    assert(m.html.includes("rolff-128.png"));
  }
});
