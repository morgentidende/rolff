// Retention copy: keep-until-I-delete default, optional shorter times, 3-day warning, PDF export. da + en, truthful, no provider names.
import { assert, assertStringIncludes } from "jsr:@std/assert@1";
const policy = await Deno.readTextFile("apps/web/public/privatliv.html");
const gone = await Deno.readTextFile("apps/web/public/slet-konto.html");
const section = (html: string, from: string, to: string) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert(a >= 0 && b > a, from); return html.slice(a, b); };
const da = section(policy, "<h2>5. Opbevaring</h2>", "<h2>6. ");
const en = section(policy, "<h2>5. Retention</h2>", "<h2>6. ");

Deno.test("privatliv.html (da) section 5: kept until the user deletes, no automatic deletion, shorter optional, 3-day warning, PDF export", () => {
  for (const part of ["indtil du selv sletter dem eller din konto", "Indtil jeg sletter dem", "sletter ikke beskeder automatisk", "5 år eller 1 år", "beholder de deres kopi", "3 dage før", "mail", "notifikation", "ingen beskeder, navne eller antal", "Eksportér samtale", "PDF", "længere tid"])
    assertStringIncludes(da, part);
  assert(!/1 år \(standard\)|ubegrænset/i.test(da), "old default wording is gone");
});
Deno.test("privatliv.html (en) section 5 says the same", () => {
  for (const part of ["until you delete them or your account", "Until I delete them", "does not delete messages automatically", "5 years or 1 year", "keep their copy", "3 days before", "e-mail", "notification", "no messages, names or counts", "Export conversation", "PDF", "longer time"])
    assertStringIncludes(en, part);
  assert(!/1 year \(default\)|unlimited/i.test(en), "old default wording is gone");
});
Deno.test("retention sections name no AI provider or model, and make no legal or security approval claim", () => {
  for (const s of [da, en]) assert(!/OpenAI|ChatGPT|Gemini|Grok|Claude|godkendt af|approved by|certified|certificeret|GDPR-kompatibel|GDPR[- ]compliant/i.test(s));
});
Deno.test("slet-konto.html and the policy date match the new default", () => {
  assertStringIncludes(gone, "som standard gemmes beskederne, indtil du selv sletter dem");
  assertStringIncludes(gone, "by default, messages are kept until you delete them");
  assert(!/vælge 1 år, 5 år eller ubegrænset|choose 1 year, 5 years or unlimited/.test(gone));
  assertStringIncludes(policy, "Sidst opdateret: 28. november 2026.");
});

Deno.test("sweep function: warning step runs after retention_sweep, uses the same allow-list rule as account mail, never blocks the sweep", async () => {
  const src = await Deno.readTextFile("supabase/functions/inactivity-sweep/index.ts");
  assert(src.indexOf('rpc("retention_sweep")') < src.indexOf("runRetentionWarnings("));
  assertStringIncludes(src, 'Deno.env.get("APP_ENV") ?? "test"'); assertStringIncludes(src, "TEST_MAIL_ALLOW");
  assertStringIncludes(src, "catch"); assert(!/console\.log\([^)]*(email|\bto\b)/i.test(src), "no addresses in logs");
});
