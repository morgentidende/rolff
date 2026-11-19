// sendMailResult: SMTP when configured (fake server), relay fallback, failure reasons, and a content-free mail_log row.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SmtpConn } from "../../supabase/functions/_shared/smtp.ts";
Deno.env.set("APP_URL", "https://example.test/");
Deno.env.set("SUPABASE_URL", "https://sb.example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test");
Deno.env.set("MAILER_URL", "https://mailer.example.test/send");
Deno.env.set("MAILER_SECRET", "mailer-test");
const E = await import("../../supabase/functions/_shared/email.ts");

const logs: Record<string, unknown>[] = []; let relayStatus = 200; let relayHits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init); const u = new URL(req.url);
  if (u.host === "sb.example.test" && u.pathname === "/rest/v1/mail_log") { assertEquals(req.headers.get("apikey"), "service-test"); logs.push(await req.json()); return new Response(null, { status: 201 }); }
  if (u.host === "mailer.example.test") { relayHits++; await req.body?.cancel(); return new Response("{}", { status: relayStatus }); }
  throw new Error("unexpected network call: " + u.host);
};
function server(rcpt = "250 Ok") {
  const enc = new TextEncoder(), dec = new TextDecoder(); const q: string[] = ["220 hi\r\n"]; let inData = false; let buf = ""; let wake: (() => void) | null = null; let closed = false;
  const say = (s: string) => { q.push(s); wake?.(); };
  const conn: SmtpConn = {
    async read(p) { while (!q.length) { if (closed) return null; await new Promise<void>((r) => { wake = r; }); } const b = enc.encode(q.shift()!); p.set(b); return b.length; },
    async write(p) { buf += dec.decode(p);
      for (;;) { if (inData) { const e = buf.indexOf("\r\n.\r\n"); if (e < 0) break; buf = buf.slice(e + 5); inData = false; say("250 queued\r\n"); continue; }
        const i = buf.indexOf("\r\n"); if (i < 0) break; const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (l.startsWith("EHLO")) say("250 ok\r\n"); else if (l.startsWith("AUTH")) say("235 ok\r\n"); else if (l.startsWith("MAIL")) say("250 ok\r\n");
        else if (l.startsWith("RCPT")) say(rcpt + "\r\n"); else if (l === "DATA") { say("354 go\r\n"); inData = true; } else if (l === "QUIT") say("221 bye\r\n"); }
      return p.length; },
    close() { closed = true; wake?.(); },
  };
  return conn;
}
const msg = { subject: "Hemmeligt emne", html: "<p>hemmelig tekst</p>", text: "hemmelig tekst" };
const noContent = (row: Record<string, unknown>) => { const j = JSON.stringify(row); assert(!/hemmelig|Hemmeligt|far@example|example\.test/i.test(j), j); };

Deno.test("relay fallback (no SMTP configured): success and 502 are logged with provider code", async () => {
  logs.length = 0; relayStatus = 200;
  assertEquals(await E.sendMailResult("far@example.test", msg, "invite"), { ok: true, provider: "relay", code: 200, reason: "ok" });
  relayStatus = 502;
  assertEquals(await E.sendMailResult("far@example.test", msg, "invite"), { ok: false, provider: "relay", code: 502, reason: "relay:502" });
  assertEquals(logs.map((l) => [l.kind, l.status, l.provider, l.response_code]), [["invite", "sent", "relay", 200], ["invite", "failed", "relay", 502]]);
  logs.forEach(noContent);
  assertEquals(await E.sendMail("far@example.test", msg), false, "boolean wrapper still works");
});
Deno.test("SMTP configured: relay is not used; rejection reason is logged; recipient only as a keyed hash", async () => {
  Deno.env.set("SMTP_USER", "no-reply@nicolaipetersen.dk"); Deno.env.set("SMTP_PASS", "test-pass");
  try {
    logs.length = 0; relayHits = 0;
    E._setSmtpConnect(async () => server());
    const ok = await E.sendMailResult("Far@Example.test", msg, "invite");
    assertEquals(ok, { ok: true, provider: "smtp", code: 250, reason: "ok" });
    E._setSmtpConnect(async () => server("550 5.1.1 no such user"));
    const bad = await E.sendMailResult("far@example.test", msg, "resend");
    assertEquals(bad, { ok: false, provider: "smtp", code: 550, reason: "rcpt:550" });
    assertEquals(relayHits, 0);
    assertEquals(logs.map((l) => [l.kind, l.status, l.provider, l.response_code, l.reason]), [["invite", "sent", "smtp", 250, "ok"], ["resend", "failed", "smtp", 550, "rcpt:550"]]);
    assertEquals(logs[0].recipient_hash, logs[1].recipient_hash, "hash is case-insensitive");
    assertEquals(String(logs[0].recipient_hash).length, 32);
    assertEquals(Object.keys(logs[0]).sort(), ["kind", "provider", "reason", "recipient_hash", "response_code", "status"]);
    logs.forEach(noContent);
    assertEquals(E.smtpConfig()?.host, "smtp.hostinger.com"); assertEquals(E.smtpConfig()?.port, 465); assertEquals(E.smtpConfig()?.from, "no-reply@nicolaipetersen.dk");
  } finally { Deno.env.delete("SMTP_USER"); Deno.env.delete("SMTP_PASS"); E._setSmtpConnect(undefined); }
});
Deno.test("not configured at all -> failed with reason not_configured, still logged", async () => {
  const u = Deno.env.get("MAILER_URL")!; Deno.env.delete("MAILER_URL"); logs.length = 0;
  try { assertEquals(await E.sendMailResult("far@example.test", msg, "approval"), { ok: false, provider: "none", code: null, reason: "not_configured" }); assertEquals(logs.length, 1); }
  finally { Deno.env.set("MAILER_URL", u); }
});
Deno.test({ name: "restore fetch", fn: () => { globalThis.fetch = realFetch; }, sanitizeOps: false, sanitizeResources: false });
