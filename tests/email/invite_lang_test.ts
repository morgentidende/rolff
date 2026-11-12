// Invitation e-mails follow the inviter's app language (da/en, default da).
// No real e-mail is sent: MAILER_URL points at a fake host and fetch is stubbed.
import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
Deno.env.set("SUPABASE_URL", "https://sb.example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-test");
Deno.env.set("MAILER_URL", "https://mailer.example.test/send");
Deno.env.set("MAILER_SECRET", "mailer-test");
const E = await import("../../supabase/functions/_shared/email.ts");
const exp = "2026-11-12T15:30:00Z"; // 16:30 in Copenhagen
const link = "https://example.test/#invite=abc";
const FOOT_DA = "Beskeder tjekkes af OpenAI", FOOT_EN = "Messages are checked by OpenAI";

Deno.test("mailLang: only da|en, everything else falls back to da", () => {
  assertEquals(E.mailLang("en"), "en"); assertEquals(E.mailLang("da"), "da");
  for (const v of [undefined, null, "", "EN", "de", 1, {}, "en-GB"]) assertEquals(E.mailLang(v), "da");
});

const all = (lang?: "da" | "en") => ({
  invite: E.inviteMail({ inviterEmail: "a@x.test", link, expires: exp, inviteeEmail: "b@x.test", lang }),
  copy: E.copyMail({ inviteeEmail: "b@x.test", expires: exp, lang }),
  approval: E.approvalMail({ role: "reader", appUrl: "https://example.test/", lang }),
  member: E.memberInviteMail({ inviterEmail: "a@x.test", link, expires: exp, role: "writer", inviteeEmail: "c@x.test", lang }),
});

Deno.test("English: subject, html lang, body, en-GB Copenhagen date, bilingual test warning kept", () => {
  const m = all("en");
  assertEquals(m.invite.subject, "a@x.test has invited you to Rolff");
  assertEquals(m.copy.subject, "Copy: Your invitation to b@x.test has been sent");
  assertEquals(m.approval.subject, "Rolff: Approve or decline a new participant");
  assertEquals(m.member.subject, "a@x.test has invited you to take part in a conversation in Rolff");
  for (const [k, x] of Object.entries(m)) {
    assert(x.html.startsWith('<!doctype html><html lang="en">'), k);
    assert(x.html.includes("This is a test version of Rolff"), k);
    assert(x.html.includes(FOOT_DA) && x.html.includes(FOOT_EN), `${k}: bilingual footer`);
    assert(x.text.includes(FOOT_DA) && x.text.toLowerCase().includes(FOOT_EN.toLowerCase()), `${k}: bilingual text footer`);
    assert(x.html.includes("Hi,") && !x.html.includes("Hej,"), k);
    assert(!/Åbn|udløber|Kopiér|godkendt/.test(x.html.replace(/<em>.*?<\/em>|<strong>Testversion\.<\/strong>[^<]*/gs, "")), `${k}: no Danish body text`);
  }
  assert(m.invite.html.includes("12 November at 16:30") || m.invite.html.includes("12 November, 16:30"), m.invite.html.match(/expires <strong>([^<]*)/)?.[1]);
  assert(m.invite.html.includes("Open the invitation"));
  assert(m.approval.text.includes("read only") && m.member.html.includes("read and write"));
  assertEquals(m.copy.html.includes("#invite="), false);
});

Deno.test("Danish is the default and identical to an explicit da", () => {
  const d = all(), x = all("da");
  assertEquals(JSON.stringify(d), JSON.stringify(x));
  assertEquals(d.invite.subject, "a@x.test har inviteret dig til Rolff");
  assert(d.invite.html.startsWith('<!doctype html><html lang="da">'));
  assert(d.invite.html.includes("12. november kl. 16.30") || d.invite.html.includes("12. november 16.30"), d.invite.html.match(/udløber <strong>([^<]*)/)?.[1]);
  assert(d.copy.html.includes("Dette er en testversion af Rolff"));
});

// ---- Endpoint: the invite-email function passes the caller's lang to the templates ----
type Sent = { to: string; subject: string; html: string };
const sent: Sent[] = [];
let handler: ((r: Request) => Promise<Response>) | null = null;
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: (r: Request) => Promise<Response>) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
const realFetch = globalThis.fetch;
const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init); const u = new URL(req.url);
  if (u.host === "mailer.example.test") { const b = await req.json(); sent.push({ to: b.to, subject: b.subject, html: b.html }); return new Response("ok"); }
  if (u.host !== "sb.example.test") throw new Error("unexpected network call: " + u.host);
  if (u.pathname === "/auth/v1/user") return reply({ id: "00000000-0000-0000-0000-0000000000a1", aud: "authenticated", role: "authenticated", email: "a@x.test" });
  const rpc = u.pathname.split("/rpc/")[1];
  if (rpc === "create_email_invitation") return reply([{ conversation_id: "c1", token: "tok", inviter_email: "a@x.test", expires_at: exp, invitation_id: "i1" }]);
  if (rpc === "public_label_of") return reply("a@x.test");
  if (rpc === "create_member_invitation") return reply([{ complete: false, invitation_id: "i2" }]);
  if (rpc === "pending_approver_emails") return reply([{ email: "m@x.test" }]);
  return reply([]);
};
await import("../../supabase/functions/invite-email/index.ts");
const call = (body: unknown) => handler!(new Request("https://fn.example.test/invite-email", { method: "POST", headers: { authorization: "Bearer test.jwt.token", "content-type": "application/json" }, body: JSON.stringify(body) }));

for (const [lang, expectLang, inviteSubj, copySubj] of [
  ["en", "en", "a@x.test has invited you to Rolff", "Copy: Your invitation to b@x.test has been sent"],
  ["da", "da", "a@x.test har inviteret dig til Rolff", "Kopi: Din invitation til b@x.test er sendt"],
  [undefined, "da", "a@x.test har inviteret dig til Rolff", "Kopi: Din invitation til b@x.test er sendt"],
  ["fr<script>", "da", "a@x.test har inviteret dig til Rolff", "Kopi: Din invitation til b@x.test er sendt"],
] as const) {
  Deno.test(`invite-email endpoint: lang=${String(lang)} -> invitee + inviter copy in ${expectLang}`, async () => {
    sent.length = 0;
    const r = await call({ email: "b@x.test", ...(lang === undefined ? {} : { lang }) });
    assertEquals(r.status, 200); await r.body?.cancel();
    assertEquals(sent.map((s) => [s.to, s.subject]), [["b@x.test", inviteSubj], ["a@x.test", copySubj]]);
    for (const s of sent) assert(s.html.startsWith(`<!doctype html><html lang="${expectLang}">`));
  });
}
Deno.test("invite-email endpoint: approval request follows the requester's language", async () => {
  sent.length = 0;
  const r = await call({ action: "member", conversation_id: "c1", email: "c@x.test", role: "reader", lang: "en" });
  assertEquals(r.status, 200); await r.body?.cancel();
  assertEquals(sent.map((s) => [s.to, s.subject]), [["m@x.test", "Rolff: Approve or decline a new participant"]]);
});
Deno.test({ name: "restore stubs", fn: () => { globalThis.fetch = realFetch; (Deno as unknown as { serve: unknown }).serve = realServe; }, sanitizeOps: false, sanitizeResources: false });
