import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { checkFile, cleanName, sniff, validateFileResult } from "../../supabase/functions/_shared/attachments.ts";
const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
Deno.test("sniff uses magic bytes, not names", () => {
  assertEquals(sniff(enc("\x89PNG\r\n\x1a\n....")), "image/png");
  assertEquals(sniff(enc("\xff\xd8\xff\xe0")), "image/jpeg");
  assertEquals(sniff(enc("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assertEquals(sniff(enc("GIF89a......")), "image/gif");
  assertEquals(sniff(enc("%PDF-1.7")), "application/pdf");
  assertEquals(sniff(enc("just text")), null);
});
Deno.test("checkFile rejects animation, pages, encryption, size", () => {
  assertEquals(checkFile(enc("GIF89a" + "\x21\xF9\x04x" + "\x21\xF9\x04y")), { ok: false, error: "animated" });
  assertEquals(checkFile(enc("GIF89aNETSCAPE2.0")), { ok: false, error: "animated" });
  assertEquals(checkFile(enc("RIFF\0\0\0\0WEBPVP8XANIM")), { ok: false, error: "animated" });
  assertEquals(checkFile(enc("%PDF-1.7 " + "/Type /Page ".repeat(6) + "/Type /Pages")), { ok: false, error: "too_many_pages" });
  assertEquals(checkFile(enc("%PDF-1.7 /Type /Page /Encrypt 1 0 R")), { ok: false, error: "encrypted_pdf" });
  assertEquals(checkFile(enc("%PDF-1.7 /Type /Page /Type /Pages")), { ok: true, mime: "application/pdf", pages: 1 });
  assertEquals(checkFile(new Uint8Array(4 * 1024 * 1024 + 1)), { ok: false, error: "too_large" });
  assertEquals(checkFile(new Uint8Array(0)), { ok: false, error: "empty" });
});
Deno.test("cleanName strips paths and markup", () => assertEquals(cleanName('C:\\x\\<b>"a".png'), "ba.png"));
Deno.test("validateFileResult is strict and fails closed", () => {
  const ok = validateFileResult('{"decision":"block","reason_code":"personal_attack","spans":["klovn","not there"],"transcript":"du er en klovn"}', "");
  assertEquals(ok.spans, ["klovn"]);
  assertEquals(validateFileResult('{"decision":"block","reason_code":"inappropriate_image","spans":[],"transcript":""}', "").reason_code, "inappropriate_image");
  assertThrows(() => validateFileResult('{"decision":"allow","reason_code":"personal_attack","spans":[],"transcript":""}', ""));
  assertThrows(() => validateFileResult('{"decision":"allow","reason_code":"none","spans":[]}', ""));
  assertThrows(() => validateFileResult("not json", ""));
});
