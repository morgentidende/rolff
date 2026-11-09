// Browser-only: loads the bundled PDF fonts (SIL OFL, see assets/pdf/OFL.txt) on demand.
// Fonts are only fetched when the user taps "PDF"; the emoji font only if a message needs it.
import type { PdfFonts } from "./pdfExport";
import { emojiMapFrom } from "./pdfExport";

type FontDoc = { addFileToVFS(name: string, data: string): unknown; addFont(file: string, name: string, style: string): unknown };
const b64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const get = async (u: URL) => { const r = await fetch(u); if (!r.ok) throw new Error("font_fetch"); return b64(await r.arrayBuffer()); };

export async function loadPdfFonts(doc: FontDoc, withEmoji: boolean): Promise<PdfFonts> {
  try {
    const [reg, bold] = await Promise.all([get(new URL("./assets/pdf/NotoSans-Regular.ttf", import.meta.url)), get(new URL("./assets/pdf/NotoSans-Bold.ttf", import.meta.url))]);
    doc.addFileToVFS("RolffSans-Regular.ttf", reg); doc.addFont("RolffSans-Regular.ttf", "RolffSans", "normal");
    doc.addFileToVFS("RolffSans-Bold.ttf", bold); doc.addFont("RolffSans-Bold.ttf", "RolffSans", "bold");
    const fonts: PdfFonts = { text: "RolffSans", emoji: null, emojiMap: null };
    if (withEmoji) {
      try {
        const [emo, runs] = await Promise.all([get(new URL("./assets/pdf/NotoEmoji-Regular-pua.ttf", import.meta.url)), import("./assets/pdf/emojiPua").then((m) => m.EMOJI_PUA_RUNS)]);
        doc.addFileToVFS("RolffEmoji.ttf", emo); doc.addFont("RolffEmoji.ttf", "RolffEmoji", "normal");
        fonts.emoji = "RolffEmoji"; fonts.emojiMap = emojiMapFrom(runs);
      } catch { /* emoji fall back to a placeholder box */ }
    }
    return fonts;
  } catch {
    return { text: "helvetica", emoji: null, emojiMap: null };
  }
}
