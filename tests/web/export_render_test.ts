// Conversation PDF export (model + layout). Invented data only.
import { exportFileName } from "../../apps/web/src/exportUtil.ts";
import { buildModel, dayLabel, emojiMapFrom, isoDate, isoTime, needsEmojiFont, PAGE, period, renderConversationPdf, segments, type ExportMessage, type PdfDoc } from "../../apps/web/src/pdfExport.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c: unknown, m = "assertion failed") => { if (!c) throw new Error(m); };
let n = 0;
const msg = (created_at: string, mine: boolean, body: string, extra: Partial<ExportMessage> = {}): ExportMessage => ({ id: String(++n), sender_name: mine ? "a@x.test" : "Mor (alias)", body, created_at, mine, ...extra });
const opts = { lang: "da" as const, me: "a@x.test", partners: ["Mor (alias)"], timeZone: "Europe/Copenhagen", now: new Date("2026-11-09T10:36:00Z") };

// ---------- dates & timezone ----------
Deno.test("Datoer: dansk dagsoverskrift og periode i brugerens tidszone", () => {
  eq(dayLabel("2026-11-06T12:00:00Z", "da", "Europe/Copenhagen"), "Fredag 6. november 2026");
  eq(dayLabel("2026-11-06T12:00:00Z", "en", "Europe/Copenhagen"), "Friday 6 November 2026");
  eq(isoDate("2026-11-06T23:30:00Z", "Europe/Copenhagen"), "2026-11-07");
  eq(isoDate("2026-11-06T23:30:00Z", "America/New_York"), "2026-11-06");
  eq(isoTime("2026-11-06T23:30:00Z", "Europe/Copenhagen"), "00:30");
  eq(period([{ created_at: "2026-11-06T08:00:00Z" }, { created_at: "2026-11-09T08:00:00Z" }], "da", "Europe/Copenhagen"), "6. november 2026 – 9. november 2026");
  eq(period([{ created_at: "2026-11-06T08:00:00Z" }], "da", "Europe/Copenhagen"), "6. november 2026");
  const m = buildModel([], opts); eq(m.exportedAt, "9. november 2026 kl. 11.36");
});
Deno.test("Gruppering: dage efter lokal midnat, afsender vises ved skift", () => {
  const m = buildModel([
    msg("2026-11-06T22:50:00Z", false, "sen aften"), msg("2026-11-06T23:10:00Z", false, "efter midnat i DK"),
    msg("2026-11-06T23:11:00Z", false, "igen"), msg("2026-11-06T23:12:00Z", true, "svar"), msg("2026-11-06T23:13:00Z", false, "tilbage"),
  ], opts);
  eq(m.days.map((d) => d.label), ["Fredag 6. november 2026", "Lørdag 7. november 2026"]);
  eq(m.days[1].items.map((i) => i.showSender), [true, false, true, true]);
  eq(m.days[0].items[0].time, "23.50"); eq(m.count, 5);
  const ny = buildModel(m.days.flatMap((d) => d.items.map((i) => i.m)), { ...opts, timeZone: "America/New_York" });
  eq(ny.days.length, 1);
});
Deno.test("Model: alias, svar og vedhæftning bevares; kun de givne beskeder", () => {
  const m = buildModel([
    msg("2026-11-07T09:00:00Z", false, "plan", { att_mime: "application/pdf", att_name: "ugeplan.pdf", att_pages: 2 }),
    msg("2026-11-07T09:05:00Z", true, "ok", { reply_to_id: "x", reply_body: null }),
  ], { ...opts, partners: [] });
  eq(m.partners, "Mor (alias)"); eq(m.days[0].items[0].attachment, "ugeplan.pdf (PDF, 2 sider)");
  eq(m.days[0].items[1].reply, "Den oprindelige besked er ikke tilgængelig."); eq(m.days[0].items[1].sender, "a@x.test");
});

Deno.test("Filnavn: eksporttidspunkt i brugerens tidszone", () => {
  eq(exportFileName("pdf", new Date("2026-11-09T23:36:00Z"), "Europe/Copenhagen"), "rolff-samtale-2026-11-10-0036.pdf");
  eq(exportFileName("pdf", new Date("2026-11-09T10:36:00Z"), "UTC"), "rolff-samtale-2026-11-09-1036.pdf");
});

// ---------- PDF layout with a recording fake document ----------
type Txt = { page: number; t: string; x: number; y: number; font: string; size: number };
function fakeDoc() {
  let page = 1, pages = 1, font = "helvetica", size = 10; const texts: Txt[] = []; const fills: { page: number; x: number; y: number; w: number; h: number }[] = [];
  const doc: PdfDoc & { texts: Txt[]; fills: typeof fills } = {
    texts, fills, internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    setFont: (f) => { font = f; }, setFontSize: (s) => { size = s; }, getTextWidth: (t) => [...t].length * size * 0.5,
    text: (t, x, y) => { texts.push({ page, t, x, y, font, size }); }, setTextColor: () => {}, setFillColor: () => {}, setDrawColor: () => {}, setLineWidth: () => {},
    roundedRect: (x, y, w, h) => { fills.push({ page, x, y, w, h }); }, rect: () => {}, line: () => {}, circle: () => {}, path: () => {}, fill: () => {},
    addPage: () => { pages++; page = pages; }, setPage: (p) => { page = p; }, getNumberOfPages: () => pages,
  };
  return doc;
}
const many = () => { const out: ExportMessage[] = []; for (let i = 0; i < 40; i++) out.push(msg(new Date(Date.UTC(2026, 10, 5 + Math.floor(i / 8), 8, i)).toISOString(), i % 3 === 0, `Besked nummer ${i} med æøå`)); return out; };
Deno.test("PDF: 'Side X af Y' og 'Eksporteret fra ROLFF' på hver side; gentaget lille header", () => {
  const doc = fakeDoc(); const r = renderConversationPdf(doc, buildModel(many(), opts));
  ok(r.pages >= 2, "multiple pages");
  for (let p = 1; p <= r.pages; p++) {
    ok(doc.texts.some((t) => t.page === p && t.t === `Side ${p} af ${r.pages}`), `footer ${p}`);
    ok(doc.texts.some((t) => t.page === p && t.t === "Eksporteret fra ROLFF"));
    if (p > 1) ok(doc.texts.some((t) => t.page === p && t.t.startsWith("Eksporteret samtale · Mor (alias)")), `header ${p}`);
  }
  ok(doc.texts.some((t) => t.page === 1 && t.t === "Eksporteret samtale")); ok(doc.texts.some((t) => t.t === "Fredag 6. november 2026"));
});
Deno.test("PDF: egne beskeder højrestillet, modpartens venstrestillet; ingen tekst i marginen", () => {
  const doc = fakeDoc(); const W = 595.28, M = PAGE.margin;
  renderConversationPdf(doc, buildModel([msg("2026-11-06T08:00:00Z", true, "Min egen besked"), msg("2026-11-06T08:01:00Z", false, "Modpartens besked")], opts));
  const own = doc.texts.find((t) => t.t === "Min egen besked")!, other = doc.texts.find((t) => t.t === "Modpartens besked")!;
  ok(own.x > W / 2, "own right"); ok(other.x < W / 2 && other.x >= M, "other left");
  ok(own.x + own.t.length * own.size * 0.5 <= W - M + 0.01, "own inside right margin");
  for (const t of doc.texts) ok(t.x >= M - 0.01 && t.x + [...t.t].length * t.size * 0.5 <= W - M + 0.5, `margin: ${t.t}`);
});
Deno.test("PDF: lange beskeder ombrydes, og en boble deles ikke mellem sider", () => {
  const long = "Dette er en meget lang opdigtet besked om afhentning og weekendplaner. ".repeat(6);
  const msgs = [...many().slice(0, 18), msg("2026-11-08T12:00:00Z", true, long.trim())];
  const doc = fakeDoc(); renderConversationPdf(doc, buildModel(msgs, opts));
  const lines = doc.texts.filter((t) => long.includes(t.t) && t.t.length > 20 && t.size === 10.5);
  ok(lines.length > 3, "wrapped"); eq(new Set(lines.map((l) => l.page)).size, 1);
  eq(lines.map((l) => l.t).join(" ").replace(/\s+/g, " "), long.trim());
});
Deno.test("PDF: emoji mappes til emoji-fontens PUA-glyffer; variationsvælgere fjernes", () => {
  const fonts = { text: "RolffSans", emoji: "RolffEmoji", emojiMap: emojiMapFrom([[0x1f600, 2], [0x1f44d, 1]]) };
  eq(segments("Hej 😀👍❤️!", fonts), [{ t: "Hej ", emoji: false }, { t: "\ue000\ue002\u2764", emoji: true }, { t: "!", emoji: false }]);
  eq(needsEmojiFont(["hej", null, "ok 👍"]), true); eq(needsEmojiFont(["æøå"]), false);
  eq(segments("😀", { text: "helvetica", emoji: null, emojiMap: null }), [{ t: "\u25A1", emoji: false }]);
});
