// PAdES-style detached PKCS#7 (CMS, SHA-256) signature over the whole PDF (ByteRange), with the
// ROLFF signing certificate from Edge secrets EXPORT_SIGNING_P12_B64 / EXPORT_SIGNING_P12_PASSWORD.
// Without the secrets, exports fail closed (no unsigned court PDFs).
import { Buffer } from "node:buffer";
import { SignPdf } from "npm:@signpdf/signpdf@3.2.4";
import { plainAddPlaceholder } from "npm:@signpdf/placeholder-plain@3.2.4";
import { P12Signer } from "npm:@signpdf/signer-p12@3.2.4";

export type SigningKey = { p12: Uint8Array; passphrase: string };
export function signingKeyFromEnv(env: { get(k: string): string | undefined } = Deno.env): SigningKey | null {
  const b64 = env.get("EXPORT_SIGNING_P12_B64"), pass = env.get("EXPORT_SIGNING_P12_PASSWORD");
  if (!b64 || pass === undefined) return null;
  try { return { p12: Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0)), passphrase: pass }; } catch { return null; }
}
export async function signPdf(pdf: Uint8Array, key: SigningKey, exportId: string): Promise<Uint8Array> {
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: Buffer.from(pdf), reason: `ROLFF udskrift ${exportId}`, contactInfo: "ROLFF", name: "ROLFF", location: "Danmark", signatureLength: 8192,
  });
  const signed = await new SignPdf().sign(withPlaceholder, new P12Signer(Buffer.from(key.p12), { passphrase: key.passphrase }));
  return new Uint8Array(signed);
}
