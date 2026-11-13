export type AttachmentKind = "photos" | "files";
export type RecipientAttachmentBlocks = { photos: boolean; files: boolean };

export const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const FILE_ACCEPT_PDF = "application/pdf";

export function pickerAccept(blocks: RecipientAttachmentBlocks): string | null {
  if (blocks.photos && blocks.files) return null;
  if (blocks.photos) return FILE_ACCEPT_PDF;
  if (blocks.files) return PHOTO_ACCEPT;
  return "image/png,image/jpeg,image/webp,image/gif,application/pdf";
}

export function blockedAttachmentNotice(lang: "da" | "en", kind: AttachmentKind): string {
  if (lang === "da") {
    return kind === "photos"
      ? "Filen blev ikke sendt: Modtageren tager ikke imod fotos i denne samtale."
      : "Filen blev ikke sendt: Modtageren tager ikke imod filer i denne samtale.";
  }
  return kind === "photos"
    ? "The file was not sent: the recipient does not accept photos in this conversation."
    : "The file was not sent: the recipient does not accept files in this conversation.";
}

export function recipientAttachHint(lang: "da" | "en", blocks: RecipientAttachmentBlocks): string | null {
  if (!blocks.photos && !blocks.files) return null;
  if (lang === "da") {
    if (blocks.photos && blocks.files) return "Modtageren tager ikke imod fotos eller filer i denne samtale.";
    if (blocks.photos) return "Modtageren tager ikke imod fotos i denne samtale.";
    return "Modtageren tager ikke imod filer i denne samtale.";
  }
  if (blocks.photos && blocks.files) return "The recipient does not accept photos or files in this conversation.";
  if (blocks.photos) return "The recipient does not accept photos in this conversation.";
  return "The recipient does not accept files in this conversation.";
}

export function fileIsBlockedType(file: { type: string }, blocks: RecipientAttachmentBlocks): AttachmentKind | null {
  const mime = file.type;
  if ((mime === "application/pdf") && blocks.files) return "files";
  if (mime.startsWith("image/") && blocks.photos) return "photos";
  return null;
}
