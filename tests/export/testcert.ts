// Throwaway self-signed signing certificate generated at test/preview time. Never committed, never a production key.
import forge from "npm:node-forge@1.3.1";
export function makeTestP12(pass = "test", cn = "ROLFF udskrift (TEST)"): { p12: Uint8Array; certPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048); const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = "01" + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: "commonName", value: cn }, { name: "organizationName", value: "ROLFF" }, { name: "countryName", value: "DK" }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, nonRepudiation: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { algorithm: "3des" })).getBytes();
  return { p12: Uint8Array.from(der, (c: string) => c.charCodeAt(0)), certPem: forge.pki.certificateToPem(cert) };
}
/** Minimal CMS check: ByteRange digest == signed messageDigest, and RSA signature over signedAttrs verifies with the embedded cert. */
export function verifyPdfSignature(pdf: Uint8Array): { ok: boolean; digestOk: boolean; sigOk: boolean; cn: string; coversWholeFile: boolean } {
  const s = new TextDecoder("latin1").decode(pdf);
  const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s)!; const [a, b, c, d] = br.slice(1).map(Number);
  const hex = s.slice(a + b + 1, c - 1).replace(/0+$/, ""); const der = forge.util.hexToBytes(hex.length % 2 ? hex + "0" : hex);
  const signedBytes = new Uint8Array([...pdf.subarray(a, a + b), ...pdf.subarray(c, c + d)]);
  const md = forge.md.sha256.create(); for (let i = 0; i < signedBytes.length; i += 0x8000) md.update(String.fromCharCode(...signedBytes.subarray(i, i + 0x8000)));
  const digest = md.digest().getBytes();
  const asn = forge.asn1.fromDer(der, { strict: false }); const msg: any = forge.pkcs7.messageFromAsn1(asn);
  const cert = msg.certificates[0];
  const si = asn.value[1].value[0].value.find((x: any) => x.tagClass === forge.asn1.Class.UNIVERSAL && x.type === forge.asn1.Type.SET && x.value?.[0]?.value?.length >= 5).value[0];
  const authAttrs = si.value.find((x: any) => x.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && x.type === 0);
  const sigVal = si.value.find((x: any) => x.type === forge.asn1.Type.OCTETSTRING).value;
  let mdAttr = "";
  for (const attr of authAttrs.value) if (forge.asn1.derToOid(attr.value[0].value) === forge.pki.oids.messageDigest) mdAttr = attr.value[1].value[0].value;
  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, authAttrs.value);
  const amd = forge.md.sha256.create(); amd.update(forge.asn1.toDer(set).getBytes());
  let sigOk = false; try { sigOk = cert.publicKey.verify(amd.digest().getBytes(), sigVal); } catch { sigOk = false; }
  const digestOk = mdAttr === digest;
  return { ok: digestOk && sigOk, digestOk, sigOk, cn: cert.subject.getField("CN").value, coversWholeFile: a === 0 && c + d === pdf.length };
}
