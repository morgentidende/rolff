// "Skift e-mail" address check: word filter, then Luna on the address only; fails closed.
// No real model call and no real e-mail: the provider, Supabase and the mailer are stubbed via fetch.
import { assert, assertEquals } from "jsr:@std/assert@1";
for (const [k, v] of Object.entries({ APP_URL: "https://example.test/", SUPABASE_URL: "https://sb.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-test", SUPABASE_ANON_KEY: "anon-test",
  MAILER_URL: "https://mailer.example.test/send", MAILER_SECRET: "mailer-test", APP_ENV: "test", TEST_MAIL_ALLOW: "@example\\.invalid$",
  MODERATION_PROVIDER: "gemini", MODERATION_TIER: "free", GEMINI_API_KEY: "fake-test-key", GEMINI_MODEL: "fake-model", MODERATION_TIMEOUT_MS: "3000" })) Deno.env.set(k, v);
const A = await import("../../supabase/functions/_shared/addressCheck.ts");
const { ModerationTechnicalError } = await import("../../supabase/functions/_shared/moderation.ts");
const fake = (out: unknown | (() => unknown), seen: string[] = []) => ({ name: "fake", model: "fake", async moderate(msg: string) { seen.push(msg); return typeof out === "function" ? (out as () => unknown)() : out; } });

Deno.test("hard word filter: local part and domain, separators and joined words", () => {
  for (const e of ["idiot@example.invalid", "du.er.en.idiot@example.invalid", "fuck_you@example.invalid", "fuckyou123@example.invalid", "anna@bitch.example", "kællingen.kælling@x.dk"]) assert(A.addressHardBlocked(e), e);
  for (const e of ["anna.hansen@example.invalid", "mor1980@gmail.com", "nicolai@rolff.dk", "dorthe-ø@example.invalid", "scunthorpe@example.invalid"]) assert(!A.addressHardBlocked(e), e);
});

Deno.test("Luna is asked about the address only (local part + domain) with the tiny prompt; block/allow honoured", async () => {
  const seen: string[] = [];
  assertEquals(await A.checkAddress(Deno.env, "kongen.af.bøvl@example.invalid", 3000, fake('{"decision":"allow"}', seen)), "allow");
  assertEquals(JSON.parse(seen[0]), { email_local_part: "kongen.af.bøvl", email_domain: "example.invalid" });
  assertEquals(await A.checkAddress(Deno.env, "dumme.svin@example.invalid", 3000, fake({ decision: "block" })), "block");
  assert(A.ADDRESS_PROMPT.includes("UNTRUSTED") && A.ADDRESS_PROMPT.length < 1200);
});

Deno.test("hard filter blocks before any model call", async () => {
  const seen: string[] = [];
  assertEquals(await A.checkAddress(Deno.env, "idiot@example.invalid", 3000, fake('{"decision":"allow"}', seen)), "block");
  assertEquals(seen.length, 0);
});

Deno.test("fails closed: invalid output, extra keys, provider error, timeout", async () => {
  for (const out of ["not json", '{"decision":"maybe"}', '{"decision":"allow","why":"x"}', () => { throw new Error("boom"); }]) {
    let threw = false; try { await A.checkAddress(Deno.env, "anna@example.invalid", 3000, fake(out)); } catch (e) { threw = e instanceof ModerationTechnicalError; }
    assert(threw, String(out));
  }
  const slow = { name: "slow", model: "slow", moderate: (_m: string, _c: unknown, signal: AbortSignal) => new Promise((_r, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) };
  let threw = false; try { await A.checkAddress(Deno.env, "anna@example.invalid", 50, slow); } catch (e) { threw = e instanceof ModerationTechnicalError; }
  assert(threw, "timeout");
});

// ---- Endpoint: account-mail change_email ----
const UID = "00000000-0000-0000-0000-0000000000a1";
let model: "allow" | "block" | "error" = "allow"; let modelCalls = 0; let links = 0; const mails: string[] = [];
let handler: ((r: Request) => Promise<Response>) | null = null;
const realServe = Deno.serve, realFetch = globalThis.fetch;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: (r: Request) => Promise<Response>) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const user = { id: UID, aud: "authenticated", role: "authenticated", email: "old@example.invalid" };
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init); const u = new URL(req.url);
  if (u.host === "generativelanguage.googleapis.com") { modelCalls++; if (model === "error") return new Response("bad", { status: 400 }); return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify({ decision: model }) }] } }] }); }
  if (u.host === "mailer.example.test") { mails.push((await req.json()).to); return new Response("ok"); }
  if (u.host !== "sb.example.test") throw new Error("unexpected network call: " + u.host);
  if (u.pathname === "/auth/v1/user") return reply(user);
  if (u.pathname === `/auth/v1/admin/users/${UID}`) return reply(user);
  if (u.pathname === "/auth/v1/token") return reply({ access_token: "a.b.c", token_type: "bearer", expires_in: 3600, refresh_token: "r", user });
  if (u.pathname === "/auth/v1/admin/generate_link") { links++; return reply({ ...user, email_otp: "123456", hashed_token: "h", action_link: "x", verification_type: "email_change_new", redirect_to: "" }); }
  if (u.pathname.endsWith("/rpc/auth_mail_allow")) return reply(true);
  return reply([]);
};
await import("../../supabase/functions/account-mail/index.ts");
const change = async (new_email: string) => { const r = await handler!(new Request("https://fn.example.test/account-mail", { method: "POST", headers: { authorization: "Bearer test.jwt.token", "content-type": "application/json" }, body: JSON.stringify({ action: "change_email", password: "synthetic-pw", new_email }) })); return { status: r.status, body: await r.json() }; };
const reset = () => { modelCalls = 0; links = 0; mails.length = 0; };

Deno.test("endpoint: clean address -> Luna allow -> confirmation sent", async () => {
  reset(); model = "allow"; const r = await change("anna.hansen@example.invalid");
  assertEquals(r.status, 200); assertEquals(modelCalls, 1); assertEquals(links, 1); assertEquals(mails.sort(), ["anna.hansen@example.invalid", "old@example.invalid"]);
});
Deno.test("endpoint: hard word -> address_rejected, no model call, no link, no mail", async () => {
  reset(); model = "allow"; const r = await change("du.er.idiot@example.invalid");
  assertEquals([r.status, r.body.error], [422, "address_rejected"]); assertEquals([modelCalls, links, mails.length], [0, 0, 0]);
});
Deno.test("endpoint: Luna block -> address_rejected, no link, no mail", async () => {
  reset(); model = "block"; const r = await change("dumme.svin@example.invalid");
  assertEquals([r.status, r.body.error], [422, "address_rejected"]); assertEquals([modelCalls, links, mails.length], [1, 0, 0]);
});
Deno.test("endpoint: Luna failure -> check_unavailable (fail closed), no link, no mail", async () => {
  reset(); model = "error"; const r = await change("anna.hansen@example.invalid");
  assertEquals([r.status, r.body.error], [503, "check_unavailable"]); assertEquals([links, mails.length], [0, 0]);
});
Deno.test({ name: "restore stubs", fn: () => { globalThis.fetch = realFetch; (Deno as unknown as { serve: unknown }).serve = realServe; }, sanitizeOps: false, sanitizeResources: false });
