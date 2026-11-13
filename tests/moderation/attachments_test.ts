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
  const ok = validateFileResult('{"decision":"block","reason_code":"personal_attack","spans":["klovn","not there"],"transcript":"du er en klovn","suggestion":""}', "");
  assertEquals(ok.spans, ["klovn"]);
  assertEquals(ok.suggestion, "");
  const img = validateFileResult('{"decision":"block","reason_code":"inappropriate_image","spans":[],"transcript":"","suggestion":"Prøv et faktuelt dokument i stedet."}', "");
  assertEquals(img.reason_code, "inappropriate_image");
  assertEquals(img.suggestion, "");
  assertThrows(() => validateFileResult('{"decision":"allow","reason_code":"personal_attack","spans":[],"transcript":"","suggestion":""}', ""));
  assertThrows(() => validateFileResult('{"decision":"allow","reason_code":"none","spans":[],"suggestion":""}', ""));
  assertThrows(() => validateFileResult("not json", ""));
});

import { findBlockedWord } from "../../supabase/functions/_shared/rules.ts";
Deno.test("blocked phrases: multi-word, whole sentences, case/diacritics incl. Æ/Ø/Å", () => {
  assertEquals(findBlockedWord("Du er en DÅRLIG FAR, ærligt.", ["dårlig far"]), "DÅRLIG FAR");
  assertEquals(findBlockedWord("du er en darlig   far", ["Dårlig far"]), "darlig   far");
  assertEquals(findBlockedWord("ØV, Æbler er gode", ["øv æbler"]), "ØV, Æbler");
  assertEquals(findBlockedWord("Det er altid din skyld at Emil er ked af det!", ["det er altid din skyld"]), "Det er altid din skyld");
  assertEquals(findBlockedWord("dårligfar", ["dårlig far"]), null);
  assertEquals(findBlockedWord("far er dårlig", ["dårlig far"]), null);
});

Deno.test("file result: controlling_demand + suggestion", () => {
  const r = validateFileResult({ decision: "block", reason_code: "controlling_demand", spans: ["du skal"], transcript: "du skal skrive under", suggestion: "Kan vi gennemgå aftalen?" }, "");
  if (r.reason_code !== "controlling_demand" || !r.suggestion) throw new Error(JSON.stringify(r));
});

Deno.test("file result: empty when no practical core / meta advice", () => {
  const r = validateFileResult({ decision: "block", reason_code: "personal_attack", spans: ["klovn"], transcript: "du er en klovn", suggestion: "Lad os holde samtalen til det konkrete." }, "");
  assertEquals(r.suggestion, "");
});

import { attachmentKind, blockedAttachmentStatus, parseAttachmentBlocks } from "../../supabase/functions/_shared/attachments.ts";
Deno.test("attachment kind is photos vs PDF files", () => {
  assertEquals(attachmentKind("image/png"), "photos");
  assertEquals(attachmentKind("image/jpeg"), "photos");
  assertEquals(attachmentKind("image/webp"), "photos");
  assertEquals(attachmentKind("image/gif"), "photos");
  assertEquals(attachmentKind("application/pdf"), "files");
  assertEquals(attachmentKind("text/plain"), null);
});
Deno.test("blocked attachment status is type-specific and off by default", () => {
  const off = { block_photos: false, block_files: false };
  assertEquals(blockedAttachmentStatus("photos", off), null);
  assertEquals(blockedAttachmentStatus("files", off), null);
  assertEquals(blockedAttachmentStatus("photos", { block_photos: true, block_files: false }), "blocked_photos");
  assertEquals(blockedAttachmentStatus("files", { block_photos: true, block_files: false }), null);
  assertEquals(blockedAttachmentStatus("files", { block_photos: false, block_files: true }), "blocked_files");
  assertEquals(blockedAttachmentStatus("photos", { block_photos: false, block_files: true }), null);
});
Deno.test("parseAttachmentBlocks fails closed on missing or non-boolean flags", () => {
  assertEquals(parseAttachmentBlocks({ block_photos: true, block_files: false }), { block_photos: true, block_files: false });
  assertEquals(parseAttachmentBlocks('{"block_photos":false,"block_files":true}'), { block_photos: false, block_files: true });
  assertThrows(() => parseAttachmentBlocks(null));
  assertThrows(() => parseAttachmentBlocks({ block_photos: true }));
  assertThrows(() => parseAttachmentBlocks({ block_photos: "true", block_files: false }));
  assertThrows(() => parseAttachmentBlocks([]));
});
