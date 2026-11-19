// invite-email endpoint: a failed mail never leaves an invitation stuck, and resend / copy-link work.
// No real e-mail: MAILER_URL is a fake host and fetch is stubbed.
import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
Deno.env.set("SUPABASE_URL", "https://sb.example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-test");
Deno.env.set("MAILER_URL", "https://mailer.example.test/send");
Deno.env.set("MAILER_SECRET", "mailer-test");
const exp = "2026-11-22T15:30:00Z";
let mailStatus = 200; const sent: { to: string; subject: string; html: string }[] = []; const rpcs: { name: string; args: any }[] = [];
let reissue: { status: number; body: unknown } = { status: 200, body: [{ token: "fresh", invitee_email: "far@x.test", inviter_email: "a@x.test", role: "parent", expires_at: exp }] };
const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
let handler: ((r: Request) => Promise<Response>) | null = null;
const realServe = Deno.serve; const realFetch = globalThis.fetch;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: (r: Request) => Promise<Response>) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init); const u = new URL(req.url);
  if (u.host === "mailer.example.test") { const b = await req.json(); sent.push({ to: b.to, subject: b.subject, html: b.html }); return new Response("{}", { status: mailStatus }); }
  if (u.host !== "sb.example.test") throw new Error("unexpected network call: " + u.host);
  if (u.pathname === "/auth/v1/user") return reply({ id: "00000000-0000-0000-0000-0000000000a1", aud: "authenticated", role: "authenticated", email: "a@x.test" });
  if (u.pathname === "/rest/v1/mail_log") { await req.body?.cancel(); return new Response(null, { status: 201 }); }
  if (u.pathname === "/rest/v1/invitations") return reply({ role: "writer" });
  const name = u.pathname.split("/rpc/")[1]; const args = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  rpcs.push({ name, args });
  if (name === "create_email_invitation") return reply([{ conversation_id: "c1", token: "tok", inviter_email: "a@x.test", expires_at: exp, invitation_id: "i1" }]);
  if (name === "public_label_of") return reply("a@x.test");
  if (name === "consent_member_invitation") return reply([{ token: "t2", invitee_email: "adv@x.test", inviter_email: "a@x.test", complete: true }]);
  if (name === "reissue_invitation_link") return reply(reissue.body, reissue.status);
  return reply(null);
};
await import("../../supabase/functions/invite-email/index.ts");
const call = async (body: unknown) => { const r = await handler!(new Request("https://fn.example.test/invite-email", { method: "POST", headers: { authorization: "Bearer test.jwt.token", "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const reset = () => { sent.length = 0; rpcs.length = 0; mailStatus = 200; };

Deno.test("new invitation: failed mail returns 502 with ids, does NOT revoke, flags mail_failed, no copy mail", async () => {
  reset(); mailStatus = 502;
  const r = await call({ email: "far@x.test" });
  assertEquals(r.status, 502);
  assertEquals(r.body.data.conversation_id, "c1"); assertEquals(r.body.data.invitation_id, "i1"); assertEquals(r.body.data.sent, false); assertEquals(r.body.data.reason, "relay:502");
  assertEquals(rpcs.some((x) => x.name === "revoke_invitation"), false);
  assertEquals(rpcs.find((x) => x.name === "set_invitation_mail_status")?.args, { inv: "i1", ok: false });
  assertEquals(sent.length, 1, "only the attempt to the invitee; no copy to the inviter");
});
Deno.test("new invitation: success clears the flag and sends the copy", async () => {
  reset();
  const r = await call({ email: "far@x.test", lang: "en" });
  assertEquals(r.status, 200);
  assertEquals(rpcs.find((x) => x.name === "set_invitation_mail_status")?.args, { inv: "i1", ok: true });
  assertEquals(sent.map((s) => s.to), ["far@x.test", "a@x.test"]);
});
Deno.test("consent: last approval with failed mail -> 502 mail_failed, invitation stays and is flagged", async () => {
  reset(); mailStatus = 500;
  const r = await call({ action: "consent", invitation_id: "i9" });
  assertEquals(r.status, 502); assertEquals(r.body.data.status, "mail_failed");
  assertEquals(rpcs.some((x) => x.name === "revoke_invitation"), false);
  assertEquals(rpcs.find((x) => x.name === "set_invitation_mail_status")?.args, { inv: "i9", ok: false });
});
Deno.test("resend: re-mints a link and mails it in the caller's language", async () => {
  reset();
  const r = await call({ action: "resend", invitation_id: "i1", lang: "en" });
  assertEquals(r.status, 200); assertEquals(r.body.data.status, "sent");
  assertEquals(rpcs.find((x) => x.name === "reissue_invitation_link")?.args, { inv: "i1" });
  assertEquals(sent.length, 1); assertEquals(sent[0].to, "far@x.test");
  assertEquals(sent[0].subject, "a@x.test has invited you to Rolff");
  assert(sent[0].html.includes("#invite=fresh") || sent[0].html.includes("invite=fresh"));
});
Deno.test("resend: member invitation uses the participant template", async () => {
  reset(); reissue = { status: 200, body: [{ token: "m1", invitee_email: "adv@x.test", inviter_email: "a@x.test", role: "reader", expires_at: exp }] };
  try {
    const r = await call({ action: "resend", invitation_id: "i2" });
    assertEquals(r.status, 200); assert(/^a@x\.test har inviteret dig til at .+ i en samtale i Rolff$/.test(sent[0].subject), sent[0].subject);
  } finally { reissue = { status: 200, body: [{ token: "fresh", invitee_email: "far@x.test", inviter_email: "a@x.test", role: "parent", expires_at: exp }] }; }
});
Deno.test("resend: mail failure -> 502 with reason, flag set", async () => {
  reset(); mailStatus = 502;
  const r = await call({ action: "resend", invitation_id: "i1" });
  assertEquals(r.status, 502); assertEquals(r.body.data.status, "mail_failed"); assertEquals(r.body.data.reason, "relay:502");
  assertEquals(rpcs.find((x) => x.name === "set_invitation_mail_status")?.args, { inv: "i1", ok: false });
});
Deno.test("link: returns a fresh link and sends no mail", async () => {
  reset();
  const r = await call({ action: "link", invitation_id: "i1" });
  assertEquals(r.status, 200); assertEquals(r.body.data.status, "link"); assert(String(r.body.data.link).includes("fresh"));
  assertEquals(sent.length, 0);
});
Deno.test("resend / link: SQL rate limit -> 429 rate_limited; unknown -> 400 not_found", async () => {
  reset(); reissue = { status: 400, body: { code: "P0001", message: "rate_limited" } };
  for (const action of ["resend", "link"]) { const r = await call({ action, invitation_id: "i1" }); assertEquals([r.status, r.body.error], [429, "rate_limited"]); }
  reissue = { status: 400, body: { code: "P0002", message: "not_found" } };
  const r = await call({ action: "resend", invitation_id: "nope" }); assertEquals([r.status, r.body.error], [400, "not_found"]);
  assertEquals(sent.length, 0);
});
Deno.test({ name: "restore stubs", fn: () => { globalThis.fetch = realFetch; (Deno as unknown as { serve: unknown }).serve = realServe; }, sanitizeOps: false, sanitizeResources: false });
