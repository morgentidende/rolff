// Court export PDF layout (server module), with a recording fake document. Invented data only.
import { buildModel, dayLabel, groupCode, isoDate, clock, utcStamp, emojiMapFrom, needsEmojiFont, PAGE, renderExportPdf, segments, validTimeZone, type ExportMessage, type ExportMeta, type PdfDoc } from "../../supabase/functions/_shared/pdf/layout.ts";
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c: unknown, m = "assertion failed") => { if (!c) throw new Error(m); };
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const msg = (created_at: string, mine: boolean, body: string, extra: Partial<ExportMessage> = {}): ExportMessage => ({ id: id(), sender_label: mine ? "a@x.test" : "Mor (alias)", sender_email: mine ? "a@x.test" : "mor@x.test", sender_deleted: false, body, created_at, mine, ...extra });
const meta = (o: Partial<ExportMeta> = {}): ExportMeta => ({ exportId: "11111111-2222-4333-8444-555555555555", verifyCode: "0123456789ABCDEF0123", verifyUrl: "https://rolff.example/tjek.html?k=0123456789ABCDEF0123", exporterEmail: "a@x.test", recipient: "advokat@x.test", partners: ["Mor (alias)"], createdAt: "2026-11-09T10:36:00Z", timeZone: "Europe/Copenhagen", periodFrom: null, periodTo: null, ...o });

Deno.test("Datoer: dansk dag, lokal tid + UTC, ugyldig tidszone falder tilbage", () => {
  eq(dayLabel("2026-11-06T12:00:00Z", "Europe/Copenhagen"), "Fredag 6. november 2026");
  eq(isoDate("2026-11-06T23:30:00Z", "Europe/Copenhagen"), "2026-11-07"); eq(isoDate("2026-11-06T23:30:00Z", "America/New_York"), "2026-11-06");
  eq(clock("2026-11-06T23:30:05Z", "Europe/Copenhagen"), "00.30.05"); eq(utcStamp("2026-11-06T23:30:05.123Z"), "2026-11-06 23:30:05 UTC");
  eq(validTimeZone("Mars/Base"), "Europe/Copenhagen"); eq(validTimeZone("America/New_York"), "America/New_York");
  eq(groupCode("0123456789ABCDEF0123"), "0123-4567-89AB-CDEF-0123");
  const m = buildModel([], meta()); eq(m.exportedAt, "9. november 2026 kl. 11.36.00"); eq(m.exportedAtUtc, "2026-11-09 10:36:00 UTC");
});
Deno.test("Model: gruppering efter lokal dag, afsenderskift, udsnit markeres, slettet afsender, svar", () => {
  const a = msg("2026-11-06T22:50:00Z", false, "sen aften"), b = msg("2026-11-06T23:10:00Z", false, "efter midnat");
  const c = msg("2026-11-06T23:12:00Z", true, "svar", { reply_to_id: a.id, has_reply: true, reply_visible: true });
  const d = msg("2026-11-06T23:13:00Z", false, "skjult svar", { has_reply: true, reply_visible: false, sender_deleted: true, sender_label: "Slettet bruger", sender_email: null });
  const m = buildModel([d, c, b, a], meta({ periodFrom: "2026-11-06T00:00:00Z", periodTo: null }));
  eq(m.days.map((x) => x.label), ["Fredag 6. november 2026", "Lørdag 7. november 2026"]);
  eq(m.days[1].items.map((i) => i.showSender), [true, true, true]);
  ok(m.partial); ok(m.scope.startsWith("Udsnit: 6. november 2026 – nu"));
  ok(m.days[1].items[1].reply!.startsWith(`Svar på besked ${a.id}: sen aften`));
  ok(m.days[1].items[2].reply!.includes("ikke er tilgængelig")); ok(m.days[1].items[2].sender.startsWith("Slettet bruger")); eq(m.days[1].items[2].senderEmail, null);
  eq(buildModel([a], meta()).scope, "Hele samtalen (6. november 2026)");
});
type Txt = { page: number; t: string; x: number; y: number; size: number };
function fakeDoc() {
  let page = 1, pages = 1, size = 10; const texts: Txt[] = []; const rects: { page: number; w: number }[] = [];
  const doc: PdfDoc & { texts: Txt[]; rects: typeof rects } = {
    texts, rects, internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    setFont: () => {}, setFontSize: (s) => { size = s; }, getTextWidth: (t) => [...t].length * size * 0.5,
    text: (t, x, y) => { texts.push({ page, t, x, y, size }); }, setTextColor: () => {}, setFillColor: () => {}, setDrawColor: () => {}, setLineWidth: () => {},
    roundedRect: () => {}, rect: (_x, _y, w) => { rects.push({ page, w }); }, line: () => {}, circle: () => {}, path: () => {}, fill: () => {},
    addPage: () => { pages++; page = pages; }, setPage: (p) => { page = p; }, getNumberOfPages: () => pages,
  };
  return doc;
}
const many = () => Array.from({ length: 40 }, (_, i) => msg(new Date(Date.UTC(2026, 10, 5 + Math.floor(i / 8), 8, i)).toISOString(), i % 3 === 0, `Besked nummer ${i} med æøå`));
const qr = { size: 21, isDark: (r: number, c: number) => (r + c) % 3 === 0 };
Deno.test("PDF: hver side har 'Side X af Y', verifikationskode, link, eksport-ID og QR", () => {
  const doc = fakeDoc(); const r = renderExportPdf(doc, buildModel(many(), meta()), undefined, qr);
  ok(r.pages >= 2);
  for (let p = 1; p <= r.pages; p++) {
    const on = (s: string) => doc.texts.some((t) => t.page === p && t.t === s);
    ok(on(`Side ${p} af ${r.pages}`), `side ${p}`); ok(on("Kode: 0123-4567-89AB-CDEF-0123")); ok(on("https://rolff.example/tjek.html?k=0123456789ABCDEF0123"));
    ok(on("Eksport-ID 11111111-2222-4333-8444-555555555555")); ok(on("Eksporteret fra ROLFF"));
    ok(doc.rects.filter((x) => x.page === p).length > 20, `qr modules on page ${p}`);
  }
  ok(doc.texts.some((t) => t.page === 1 && t.t === "Udskrift af samtale")); ok(doc.texts.some((t) => t.t === "advokat@x.test"));
});
Deno.test("PDF: hver besked har lokal tid, UTC og besked-ID; egne højre, modpart venstre; intet i margen", () => {
  const a = msg("2026-11-06T08:00:00Z", true, "Min egen besked"), b = msg("2026-11-06T08:01:00Z", false, "Modpartens besked");
  const doc = fakeDoc(); renderExportPdf(doc, buildModel([a, b], meta()));
  const W = 595.28, M = PAGE.margin;
  const own = doc.texts.find((t) => t.t === "Min egen besked")!, other = doc.texts.find((t) => t.t === "Modpartens besked")!;
  ok(own.x > W / 2); ok(other.x < W / 2);
  ok(doc.texts.some((t) => t.t === `09.00.00 (2026-11-06 08:00:00 UTC) · Besked-ID ${a.id}`));
  ok(doc.texts.some((t) => t.t === `Mor (alias) · mor@x.test`));
  for (const t of doc.texts) ok(t.x >= M - 0.01 && t.x + [...t.t].length * t.size * 0.5 <= W - M + 0.5, `margin: ${t.t}`);
});
Deno.test("PDF: vedhæftning med navn og SHA-256 (ikke indhold); udsnit vises i infokort", () => {
  const sha = "ab".repeat(32);
  const doc = fakeDoc(); renderExportPdf(doc, buildModel([msg("2026-11-06T08:00:00Z", false, "Ugeplan", { att_mime: "application/pdf", att_name: "ugeplan.pdf", att_size: 2048, att_pages: 2, att_sha256: sha })], meta({ periodFrom: "2026-11-01T00:00:00Z", periodTo: "2026-11-07T22:59:59Z" })));
  const all = doc.texts.map((t) => t.t).join("\n");
  ok(all.includes("Vedhæftning: ugeplan.pdf (PDF, 2 sider, 2 KB)")); ok(all.replace(/\n/g, "").includes(`SHA-256: ${sha}`));
  ok(doc.texts.some((t) => t.t === "UDSNIT")); ok(all.includes("1. november 2026 – 7. november 2026"));
});
Deno.test("PDF: lange beskeder ombrydes uden tab, og en boble deles ikke mellem sider", () => {
  const long = "Dette er en meget lang opdigtet besked om afhentning og weekendplaner. ".repeat(6).trim();
  const doc = fakeDoc(); renderExportPdf(doc, buildModel([...many().slice(0, 18), msg("2026-11-08T12:00:00Z", true, long)], meta()));
  const lines = doc.texts.filter((t) => t.size === 10.5 && long.includes(t.t) && t.t.length > 20);
  ok(lines.length > 3); eq(new Set(lines.map((l) => l.page)).size, 1); eq(lines.map((l) => l.t).join(" "), long);
});
Deno.test("PDF: emoji mappes til PUA-glyffer; uden emoji-font vises pladsholder", () => {
  const fonts = { text: "RolffSans", emoji: "RolffEmoji", emojiMap: emojiMapFrom([[0x1f600, 2], [0x1f44d, 1]]) };
  eq(segments("Hej 😀👍❤️!", fonts), [{ t: "Hej ", emoji: false }, { t: "\ue000\ue002\u2764", emoji: true }, { t: "!", emoji: false }]);
  eq(needsEmojiFont(["ok 👍"]), true); eq(needsEmojiFont(["æøå"]), false);
  eq(segments("😀", { text: "helvetica", emoji: null, emojiMap: null }), [{ t: "\u25A1", emoji: false }]);
});
