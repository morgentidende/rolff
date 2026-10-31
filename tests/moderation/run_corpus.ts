// Runs the corpus against the real provider. Key read from env or /workspace/.secrets/gemini_api_key.
// Never prints the key or stores message text anywhere except the result file (synthetic data only).
import { moderate, providerFromEnv } from "../../supabase/functions/_shared/moderation.ts";
const corpus = JSON.parse(await Deno.readTextFile(new URL("./corpus.json", import.meta.url)));
const env = new Map<string, string>(Object.entries(Deno.env.toObject()));
if (!env.get("GEMINI_API_KEY")) { try { env.set("GEMINI_API_KEY", (await Deno.readTextFile("/workspace/.secrets/gemini_api_key")).trim()); } catch { /* none */ } }
env.set("APP_ENV", "test");
const provider = providerFromEnv({ get: (k) => env.get(k) });
const rows: any[] = []; let ok = 0, err = 0;
for (const c of corpus) {
  let got = "error", reason = "", spans: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const r = await moderate(provider, c.text, [], 30000); got = r.decision; reason = r.reason_code; spans = r.spans; break; }
    catch (e) { reason = (e as Error).message; await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); }
  }
  if (got === "error") err++; else if (got === c.expect) ok++;
  rows.push({ id: c.id, lang: c.lang, cat: c.cat, expect: c.expect, got, reason, spans });
  console.log(`${got === c.expect ? "ok  " : got === "error" ? "ERR " : "MISS"} ${c.id} expect=${c.expect} got=${got} ${reason}`);
  await new Promise((r) => setTimeout(r, Number(env.get("CORPUS_DELAY_MS") ?? 4500))); // stay within free-tier RPM
}
const fp = rows.filter((r) => r.expect === "allow" && r.got === "block").length;
const fn = rows.filter((r) => r.expect === "block" && r.got === "allow").length;
const summary = { provider: provider.name, model: provider.model, date: new Date().toISOString(), total: rows.length, correct: ok, false_blocks: fp, missed_blocks: fn, technical_errors: err };
console.log(JSON.stringify(summary));
await Deno.writeTextFile(new URL(`./results-${provider.model}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 2));
