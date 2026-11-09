// Server-side PDF rendering with jsPDF + bundled Noto fonts (SIL OFL) + QR code per page.
import { jsPDF } from "npm:jspdf@2.5.2";
import qrcode from "npm:qrcode-generator@1.4.4";
import { emojiMapFrom, needsEmojiFont, renderExportPdf, type ExportModel, type PdfFonts } from "./layout.ts";
import { EMOJI_PUA_RUNS } from "./emojiPua.ts";
import { NOTO_SANS_REGULAR } from "./font-NotoSans-Regular.ts";
import { NOTO_SANS_BOLD } from "./font-NotoSans-Bold.ts";
import { NOTO_EMOJI_PUA } from "./font-NotoEmoji-Regular-pua.ts";

export function qrFor(text: string) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return { size: q.getModuleCount(), isDark: (r: number, c: number) => q.isDark(r, c) };
}
export function renderPdf(model: ExportModel): { bytes: Uint8Array; pages: number } {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.setProperties({ title: `${model.title} – ${model.meta.exportId}`, subject: "ROLFF udskrift af samtale", creator: "ROLFF", author: "ROLFF" });
  doc.addFileToVFS("RolffSans-Regular.ttf", NOTO_SANS_REGULAR); doc.addFont("RolffSans-Regular.ttf", "RolffSans", "normal");
  doc.addFileToVFS("RolffSans-Bold.ttf", NOTO_SANS_BOLD); doc.addFont("RolffSans-Bold.ttf", "RolffSans", "bold");
  const fonts: PdfFonts = { text: "RolffSans", emoji: null, emojiMap: null };
  const texts = [model.partners, model.meta.recipient, model.meta.exporterEmail, ...model.days.flatMap((d) => d.items.flatMap((i) => [i.m.body, i.sender, i.reply, i.attachment]))];
  if (needsEmojiFont(texts)) {
    doc.addFileToVFS("RolffEmoji.ttf", NOTO_EMOJI_PUA); doc.addFont("RolffEmoji.ttf", "RolffEmoji", "normal");
    fonts.emoji = "RolffEmoji"; fonts.emojiMap = emojiMapFrom(EMOJI_PUA_RUNS);
  }
  const r = renderExportPdf(doc as never, model, fonts, qrFor(model.meta.verifyUrl));
  return { bytes: new Uint8Array(doc.output("arraybuffer")), pages: r.pages };
}
export async function sha256Hex(b: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b))), (x) => x.toString(16).padStart(2, "0")).join("");
}
