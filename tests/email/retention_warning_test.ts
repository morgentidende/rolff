// Retention warning mail (3 days before) and the daily runner. Templates and fakes only: no mail is sent, no database, no provider.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
Deno.env.set("APP_URL", "https://example.test/");
import { retentionWarningMail } from "../../supabase/functions/_shared/email.ts";
import { retentionLink, runRetentionWarnings, type WarnDeps } from "../../supabase/functions/_shared/retentionWarn.ts";

const LINK = "https://example.test/#privacy";
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

Deno.test("Danish mail: subject, 3 days, chosen time, PDF export how-to, longer time / Indtil jeg sletter dem, deep link, neutral footer", () => {
  const m = retentionWarningMail({ link: LINK, retention: "1y" });
  assertEquals(m.subject, "Rolff: Nogle af dine gamle beskeder slettes om 3 dage");
  for (const part of ["3 dage", "1 år", "Eksportér samtale", "PDF", "Indtil jeg sletter dem", "Privatliv og sletning", "Behold mine beskeder i", "Åbn Privatliv og sletning", "eneste advarsel", "Mailen indeholder ingen beskeder"]) {
    assertStringIncludes(strip(m.html), part); assertStringIncludes(m.text, part);
  }
  assertStringIncludes(m.html, `href="${LINK}"`); assertStringIncludes(m.text, LINK);
  assertStringIncludes(m.html, "Testversion."); assertStringIncludes(m.text, "Test version: do not enter real or sensitive information");
  assert(m.html.includes('lang="da"'));
});

Deno.test("English mail follows the app language; 5 years label; same structure", () => {
  const m = retentionWarningMail({ link: LINK, retention: "5y", lang: "en" });
  assertEquals(m.subject, "Rolff: Some of your old messages will be deleted in 3 days");
  for (const part of ["3 days", "5 years", "Export conversation", "PDF", "Until I delete them", "Privacy and deletion", "Keep my messages for", "Open Privacy and deletion", "only warning", "contains no messages"]) {
    assertStringIncludes(strip(m.html), part); assertStringIncludes(m.text, part);
  }
  assertStringIncludes(m.html, `href="${LINK}"`); assert(m.html.includes('lang="en"'));
  assertEquals(retentionWarningMail({ link: LINK, retention: "1y", lang: "xx" as never }).subject, retentionWarningMail({ link: LINK, retention: "1y" }).subject, "unknown language -> da");
});

Deno.test("mail is neutral: no message text, names, counts, conversation ids; no provider or model names; the link is escaped", () => {
  for (const lang of ["da", "en"] as const) {
    const m = retentionWarningMail({ link: 'https://example.test/#privacy"><script>x</script>', retention: "1y", lang });
    const all = m.subject + m.html + m.text;
    assert(!/OpenAI|ChatGPT|Gemini|Grok|Claude|Luna|gpt-\d/i.test(all));
    assert(!m.html.includes("<script>"));
    assert(!/\b\d+ (beskeder|messages)\b/.test(m.subject + strip(m.html)), "no counts");
  }
});

Deno.test("deep link opens the privacy sheet: #privacy on the app URL", () => {
  assertEquals(retentionLink("https://example.test/"), "https://example.test/#privacy");
  assertEquals(retentionLink(), "https://example.test/#privacy");
});

const row = (id: string, email: string | null, lang = "da", retention = "1y") => ({ user_id: id, email, lang, retention });
function deps(rows: unknown, over: Partial<WarnDeps> = {}) {
  const sent: { to: string; subject: string; kind: string; text: string }[] = [], rpcs: { name: string; args?: Record<string, unknown> }[] = [];
  const d: WarnDeps = {
    rpc: async (name, args) => { rpcs.push({ name, args }); return name === "claim_retention_warnings" ? { data: rows, error: null } : { data: null, error: null }; },
    send: async (to, m, kind) => { sent.push({ to, subject: m.subject, kind, text: m.text }); return true; },
    allowed: () => true, link: LINK, ...over,
  };
  return { d, sent, rpcs };
}

Deno.test("runner: one mail per claimed user in their language, kind 'retention', each with the privacy link", async () => {
  const { d, sent } = deps([row("u1", "a@example.invalid", "da", "1y"), row("u2", "b@example.invalid", "en", "5y")]);
  const r = await runRetentionWarnings(d);
  assertEquals(r, { claimed: 2, mailed: 2, skipped: 0, released: 0 });
  assertEquals(sent.map((s) => [s.to, s.kind, s.subject]), [["a@example.invalid", "retention", "Rolff: Nogle af dine gamle beskeder slettes om 3 dage"], ["b@example.invalid", "retention", "Rolff: Some of your old messages will be deleted in 3 days"]]);
  assert(sent.every((s) => s.text.includes(LINK)));
});

Deno.test("runner: nothing claimed -> nothing sent; claim error -> nothing sent and no exception", async () => {
  const a = deps([]); assertEquals(await runRetentionWarnings(a.d), { claimed: 0, mailed: 0, skipped: 0, released: 0 }); assertEquals(a.sent.length, 0);
  const b = deps(null, { rpc: async () => ({ data: null, error: { message: "boom" } }) }); assertEquals((await runRetentionWarnings(b.d)).claimed, 0); assertEquals(b.sent.length, 0);
});

Deno.test("runner: a failed mail releases only that user's claim (tomorrow retries); the others are unaffected; a throwing sender counts as failure", async () => {
  const { d, sent, rpcs } = deps([row("u1", "a@example.invalid"), row("u2", "b@example.invalid"), row("u3", "c@example.invalid")], {
    send: async (to) => { if (to.startsWith("b@")) return false; if (to.startsWith("c@")) throw new Error("smtp"); return true; },
  });
  const r = await runRetentionWarnings(d);
  assertEquals(r, { claimed: 3, mailed: 1, skipped: 0, released: 2 }); assertEquals(sent.length, 0);
  assertEquals(rpcs.filter((x) => x.name === "release_retention_warning").map((x) => x.args), [{ p_uid: "u2" }, { p_uid: "u3" }]);
});

Deno.test("runner: no address or address not allowed in this environment -> no mail, claim kept (the push, if any, is already queued)", async () => {
  const { d, sent, rpcs } = deps([row("u1", null), row("u2", "  "), row("u3", "x@example.invalid"), row("u4", "ok@example.invalid")], { allowed: (e) => e.startsWith("ok@") });
  const r = await runRetentionWarnings(d);
  assertEquals(r, { claimed: 4, mailed: 1, skipped: 3, released: 0 }); assertEquals(sent.map((s) => s.to), ["ok@example.invalid"]);
  assertEquals(rpcs.filter((x) => x.name === "release_retention_warning").length, 0);
});
