// Authenticated SMTP transport with a fake in-memory SMTP server. No network, no real mail.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { buildMime, encodeHeader, type SmtpConn, smtpSend } from "../../supabase/functions/_shared/smtp.ts";

type Script = Partial<Record<"greeting" | "ehlo" | "auth" | "mail" | "rcpt" | "data" | "body", string>>;
/** A fake server: records client lines, answers each command from the script (default: success). */
function fakeServer(script: Script = {}, opts: { hang?: boolean } = {}) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const out: Uint8Array[] = []; const lines: string[] = []; let inData = false; let dataBuf = ""; let data = ""; let closed = false;
  let wake: (() => void) | null = null;
  const push = (s: string) => { out.push(enc.encode(s)); wake?.(); };
  push(script.greeting ?? "220 smtp.test ESMTP\r\n");
  const onLine = (l: string) => {
    lines.push(l);
    if (opts.hang) return;
    if (/^EHLO/.test(l)) push(script.ehlo ?? "250-smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
    else if (/^AUTH PLAIN/.test(l)) push(script.auth ?? "235 2.7.0 Authentication successful\r\n");
    else if (/^MAIL FROM/.test(l)) push(script.mail ?? "250 2.1.0 Ok\r\n");
    else if (/^RCPT TO/.test(l)) push(script.rcpt ?? "250 2.1.5 Ok\r\n");
    else if (l === "DATA") { push(script.data ?? "354 End data with <CR><LF>.<CR><LF>\r\n"); if (!script.data) inData = true; }
    else if (l === "QUIT") push("221 Bye\r\n");
  };
  let inbuf = "";
  const conn: SmtpConn = {
    async read(p) {
      while (!out.length) { if (closed) return null; await new Promise<void>((r) => { wake = r; }); wake = null; }
      const chunk = out.shift()!; p.set(chunk.subarray(0, p.length)); if (chunk.length > p.length) out.unshift(chunk.subarray(p.length)); return Math.min(chunk.length, p.length);
    },
    async write(p) {
      const s = dec.decode(p);
      if (inData) { dataBuf += s; const end = dataBuf.indexOf("\r\n.\r\n"); if (end >= 0) { data = dataBuf.slice(0, end); inData = false; inbuf = dataBuf.slice(end + 5); push(script.body ?? "250 2.0.0 Ok: queued\r\n"); } return p.length; }
      inbuf += s; let i; while ((i = inbuf.indexOf("\r\n")) >= 0) { const l = inbuf.slice(0, i); inbuf = inbuf.slice(i + 2); onLine(l); if (inData) { dataBuf = inbuf; inbuf = ""; } }
      return p.length;
    },
    close() { closed = true; wake?.(); },
  };
  return { conn, lines, get data() { return data; }, get closed() { return closed; } };
}
const cfg = { host: "smtp.test", port: 465, user: "rolff-no-reply@nicolaipetersen.dk", pass: "s3cret-pass", from: "rolff-no-reply@nicolaipetersen.dk", heloName: "nicolaipetersen.dk" };
const mime = (over: Partial<Parameters<typeof buildMime>[0]> = {}) => buildMime({ from: cfg.from, fromName: "Rolff", to: "far@example.test", subject: "Maya har inviteret dig til Rolff", html: "<p>Hej</p>", text: "Hej\n.\nslut", ...over });

Deno.test("SMTP: success path authenticates with PLAIN over the given connection and sends one message", async () => {
  const s = fakeServer(); let host = "", port = 0;
  const r = await smtpSend(cfg, "far@example.test", mime(), async (h, p) => { host = h; port = p; return s.conn; });
  assertEquals(r, { ok: true, code: 250, reason: "ok" });
  assertEquals([host, port], ["smtp.test", 465]);
  assertEquals(s.lines[0], "EHLO nicolaipetersen.dk");
  assertEquals(s.lines[1], "AUTH PLAIN " + btoa("\0rolff-no-reply@nicolaipetersen.dk\0s3cret-pass"));
  assertEquals(s.lines.slice(2, 5), ["MAIL FROM:<rolff-no-reply@nicolaipetersen.dk>", "RCPT TO:<far@example.test>", "DATA"]);
  assertEquals(s.lines.at(-1), "QUIT");
  assertMatch(s.data, /^From: "Rolff" <rolff-no-reply@nicolaipetersen\.dk>\r\n/);
  assert(s.data.includes("\r\nTo: <far@example.test>\r\n"));
  assert(/\r\nMessage-ID: <[0-9a-f]+\.\d+@nicolaipetersen\.dk>\r\n/.test(s.data));
  assert(s.closed);
});
for (const [stage, script, code] of [["auth", { auth: "535 5.7.8 Error: authentication failed\r\n" }, 535], ["rcpt", { rcpt: "550 5.1.1 User unknown\r\n" }, 550], ["mail", { mail: "553 sender rejected\r\n" }, 553], ["body", { body: "554 5.7.1 Spam\r\n" }, 554], ["greeting", { greeting: "421 busy\r\n" }, 421]] as const) {
  Deno.test(`SMTP: ${stage} failure returns "${stage}:${code}" and no server text`, async () => {
    const s = fakeServer(script);
    const r = await smtpSend(cfg, "far@example.test", mime(), async () => s.conn);
    assertEquals(r, { ok: false, code, reason: `${stage}:${code}` });
    assert(s.closed);
  });
}
Deno.test("SMTP: connect error and timeout are reported, never thrown", async () => {
  assertEquals(await smtpSend(cfg, "far@example.test", mime(), () => Promise.reject(new Error("refused"))), { ok: false, code: null, reason: "connect" });
  const s = fakeServer({}, { hang: true });
  assertEquals(await smtpSend(cfg, "far@example.test", mime(), async () => s.conn, 50), { ok: false, code: null, reason: "timeout" });
});
Deno.test("SMTP: invalid recipient never connects", async () => {
  let called = false;
  const r = await smtpSend(cfg, "bad\r\nRCPT TO:<x@y.z>", mime(), async () => { called = true; return fakeServer().conn; });
  assertEquals(r.reason, "bad_address"); assertEquals(called, false);
});
Deno.test("MIME: header injection is rejected; Danish subject is RFC 2047 encoded; bodies are base64", () => {
  let threw = false; try { mime({ subject: "x\r\nBcc: a@b.c" }); } catch { threw = true; } assert(threw);
  const m = mime({ subject: "Din invitation til Rolff – åbn den før udløb" });
  const subj = m.match(/\r\nSubject: ([\s\S]*?)\r\n(?! )/)![1];
  assert(subj.startsWith("=?UTF-8?B?"));
  const decoded = subj.split(/\r\n /).map((w) => new TextDecoder().decode(Uint8Array.from(atob(w.slice(10, -2)), (c) => c.charCodeAt(0)))).join("");
  assertEquals(decoded, "Din invitation til Rolff – åbn den før udløb");
  assert(m.includes("Content-Type: multipart/alternative;"));
  assert(!m.includes("<p>Hej</p>"), "html is base64-encoded");
  assertEquals(encodeHeader("Plain ASCII subject"), "Plain ASCII subject");
});
Deno.test("MIME: a lone dot line in the text cannot end DATA early (dot-stuffing)", async () => {
  const s = fakeServer();
  const raw = "Subject: x\r\n\r\nline\r\n.\r\nafter";
  const r = await smtpSend(cfg, "far@example.test", raw, async () => s.conn);
  assert(r.ok); assert(s.data.includes("line\r\n..\r\nafter"));
});
Deno.test("MIME: PDF attachments use multipart/mixed; unsafe names are rejected", () => {
  const m = mime({ attachments: [{ filename: "samtale.pdf", content_type: "application/pdf", content_b64: btoa("%PDF-1.4 test") }] });
  assert(m.includes("multipart/mixed") && m.includes('filename="samtale.pdf"'));
  let threw = false; try { mime({ attachments: [{ filename: "../x.pdf", content_type: "application/pdf", content_b64: "AA==" }] }); } catch { threw = true; } assert(threw);
});
