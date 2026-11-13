import { assert, assertEquals } from "jsr:@std/assert@1";
import { blockedAttachmentNotice, fileIsBlockedType, pickerAccept, recipientAttachHint } from "../../apps/web/src/attachmentBlocks.ts";

Deno.test("sender notices match the blocked-word lead-in and stay type-neutral", () => {
  assertEquals(blockedAttachmentNotice("da", "photos"), "Filen blev ikke sendt: Modtageren tager ikke imod fotos i denne samtale.");
  assertEquals(blockedAttachmentNotice("da", "files"), "Filen blev ikke sendt: Modtageren tager ikke imod filer i denne samtale.");
  assertEquals(blockedAttachmentNotice("en", "photos"), "The file was not sent: the recipient does not accept photos in this conversation.");
  assertEquals(blockedAttachmentNotice("en", "files"), "The file was not sent: the recipient does not accept files in this conversation.");
  for (const s of [blockedAttachmentNotice("da", "photos"), blockedAttachmentNotice("da", "files"), blockedAttachmentNotice("en", "photos"), blockedAttachmentNotice("en", "files")]) {
    assert(!/læst|read receipt|delivered|modtaget eller læst/i.test(s));
  }
});

Deno.test("composer accept list hides the declined type and both controls when both are blocked", () => {
  assertEquals(pickerAccept({ photos: false, files: false }), "image/png,image/jpeg,image/webp,image/gif,application/pdf");
  assertEquals(pickerAccept({ photos: true, files: false }), "application/pdf");
  assertEquals(pickerAccept({ photos: false, files: true }), "image/png,image/jpeg,image/webp,image/gif");
  assertEquals(pickerAccept({ photos: true, files: true }), null);
  assertEquals(fileIsBlockedType({ type: "image/png" }, { photos: true, files: false }), "photos");
  assertEquals(fileIsBlockedType({ type: "application/pdf" }, { photos: true, files: false }), null);
  assertEquals(recipientAttachHint("da", { photos: true, files: true }), "Modtageren tager ikke imod fotos eller filer i denne samtale.");
  assertEquals(recipientAttachHint("en", { photos: false, files: false }), null);
});

Deno.test("composer hides camera when photos are blocked and both icons when both types are blocked", async () => {
  const s = await Deno.readTextFile("apps/web/src/ComposerInput.tsx");
  assert(s.includes("recipientBlocks"));
  assert(s.includes("{showCamera &&") && s.includes("{showPaperclip &&"));
  assert(s.includes('choose("camera")') && s.includes('choose("file")'));
  const app = await Deno.readTextFile("apps/web/src/App.tsx");
  assert(app.includes("blocked_photos") && app.includes("blockedAttachmentNotice"));
  assert(app.includes("blocked_files"));
});
