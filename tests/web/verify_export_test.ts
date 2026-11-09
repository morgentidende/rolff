// Public "Tjek udskrift" helpers: the file is hashed locally; only code/SHA-256 leave the device.
import { codeFromUrl, describe, normalizeCode, sha256File, verifyExport } from "../../apps/web/src/verifyExport.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
Deno.test("Kode normaliseres og hentes fra ?k=", () => {
  eq(normalizeCode(" 0123-4567-89ab-cdef-0123 "), "0123456789ABCDEF0123"); eq(normalizeCode("<script>"), "C"); eq(codeFromUrl("?k=abcd-ef01"), "ABCDEF01"); eq(codeFromUrl(""), "");
});
Deno.test("SHA-256 beregnes lokalt", async () => {
  eq(await sha256File(new TextEncoder().encode("abc").buffer as ArrayBuffer), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
Deno.test("Kun kode og fingeraftryk sendes; svar fortolkes; 429", async () => {
  const sent: any[] = [];
  const f = async (url: string, init: RequestInit) => { sent.push({ url, init }); return { status: 200, json: async () => ({ data: { status: "match", message_count: 3, page_count: 1, created_at: "2026-11-09T10:00:00Z" } }) }; };
  const r = await verifyExport(f, "https://p.example", "pk", { sha256: "a".repeat(64) });
  eq(sent[0].url, "https://p.example/functions/v1/verify-export"); eq(JSON.parse(sent[0].init.body), { code: null, sha256: "a".repeat(64) });
  eq((r as any).status, "match"); eq(describe(r as any).title, "Ægte og uændret");
  eq(await verifyExport(async () => ({ status: 429, json: async () => ({ error: "rate_limited" }) }), "x", "k", { code: "A" }), { error: "rate_limited" });
  eq(describe({ status: "mismatch", message_count: 9 }).title, "Stemmer ikke"); eq(describe({ status: "mismatch" }).lines.join(" ").includes("9"), false);
  eq(describe({ status: "code_valid" }).tone, "info");
});
