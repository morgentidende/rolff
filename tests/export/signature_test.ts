// Real server render (jsPDF + embedded fonts + QR) and PAdES-style signing with a throwaway test certificate.
import { buildModel } from "../../supabase/functions/_shared/pdf/layout.ts";
import { renderPdf, sha256Hex } from "../../supabase/functions/_shared/pdf/render.ts";
import { signPdf, signingKeyFromEnv } from "../../supabase/functions/_shared/pdf/sign.ts";
import { makeTestP12, verifyPdfSignature } from "./testcert.ts";
const ok = (c: unknown, m = "assertion failed") => { if (!c) throw new Error(m); };
const model = () => buildModel([
  { id: "dddddddd-0000-4000-8000-000000000001", sender_label: "Mor (alias)", sender_email: "mor@x.test", sender_deleted: false, mine: false, body: "Hej 👍 æøå", created_at: "2026-11-06T08:00:00Z" },
  { id: "dddddddd-0000-4000-8000-000000000002", sender_label: "a@x.test", sender_email: "a@x.test", sender_deleted: false, mine: true, body: "Fint", created_at: "2026-11-06T08:05:00Z", att_mime: "image/jpeg", att_name: "foto.jpg", att_size: 1000, att_sha256: "ab".repeat(32) },
], { exportId: "eeeeeeee-0000-4000-8000-000000000001", verifyCode: "0123456789ABCDEF0123", verifyUrl: "https://rolff.example/tjek.html?k=0123456789ABCDEF0123", exporterEmail: "a@x.test", recipient: "a@x.test", partners: ["Mor (alias)"], createdAt: "2026-11-09T10:00:00Z", timeZone: "Europe/Copenhagen", periodFrom: null, periodTo: null });

Deno.test("Server-PDF signeres (CMS/SHA-256 over hele filen) og signaturen verificerer; ændring opdages", async () => {
  const { bytes, pages } = renderPdf(model()); ok(pages >= 1); ok(new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-");
  const { p12 } = makeTestP12("pw");
  const signed = await signPdf(bytes, { p12, passphrase: "pw" }, "eeeeeeee-0000-4000-8000-000000000001");
  const v = verifyPdfSignature(signed); ok(v.ok, JSON.stringify(v)); ok(v.coversWholeFile); ok(v.cn === "ROLFF udskrift (TEST)");
  ok(new TextDecoder("latin1").decode(signed).includes("/SubFilter /adbe.pkcs7.detached"));
  const sha = await sha256Hex(signed); ok(/^[0-9a-f]{64}$/.test(sha)); ok(sha !== await sha256Hex(bytes), "hash is taken after signing");
  const tampered = signed.slice();
  tampered[200] = tampered[200] ^ 1; ok(!verifyPdfSignature(tampered).digestOk, "tampering must break the digest");
  ok(await sha256Hex(tampered) !== sha);
});
Deno.test("Signeringsnøgle læses kun fra secrets; mangler den, er der ingen nøgle", () => {
  ok(signingKeyFromEnv({ get: () => undefined }) === null);
  const k = signingKeyFromEnv({ get: (n) => n === "EXPORT_SIGNING_P12_B64" ? btoa("abc") : "pw" }); ok(k && k.passphrase === "pw" && k.p12.length === 3);
});
