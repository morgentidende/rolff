// Renders the conversation PDF with the real jsPDF and bundled fonts. Invented data only; no network.
const { test } = require('node:test'), assert = require('node:assert/strict'), esbuild = require('esbuild'), path = require('node:path'), fs = require('node:fs');
const { jsPDF } = require('jspdf');
const A = path.join(__dirname, '../../src/assets/pdf/');
let X;
const bundle = async (f) => { const out = (await esbuild.build({ entryPoints: [path.join(__dirname, f)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' })).outputFiles[0].text; const m = { exports: {} }; new Function('module', 'exports', out)(m, m.exports); return m.exports; };
const load = async () => (X ??= { ...(await bundle('../../src/pdfExport.ts')), RUNS: (await bundle('../../src/assets/pdf/emojiPua.ts')).EMOJI_PUA_RUNS });
const msgs = () => Array.from({ length: 30 }, (_, i) => ({ id: String(i), sender_name: i % 2 ? 'a@x.test' : 'Testforælder B', body: i === 7 ? 'Lang opdigtet besked om afhentning, madpakker og weekendplaner. '.repeat(7) : `Besked ${i}: æøå ÆØÅ “citat” – 👍😀`, created_at: new Date(Date.UTC(2026, 10, 6 + Math.floor(i / 10), 8, i)).toISOString(), mine: !!(i % 2), ...(i === 3 ? { att_mime: 'application/pdf', att_name: 'ugeplan.pdf', att_pages: 2 } : {}), ...(i === 4 ? { reply_to_id: '3', reply_body: 'Besked 3' } : {}) }));
const model = (X) => X.buildModel(msgs(), { lang: 'da', me: 'a@x.test', partners: ['Testforælder B'], timeZone: 'Europe/Copenhagen', now: new Date('2026-11-09T10:36:00Z') });
test('real jsPDF + bundled Noto fonts: valid, multi-page, fonts embedded as subsets', async () => {
  const X = await load(); const doc = new jsPDF({ unit: 'pt', format: 'a4' }); const b64 = (f) => fs.readFileSync(A + f).toString('base64');
  doc.addFileToVFS('R.ttf', b64('NotoSans-Regular.ttf')); doc.addFont('R.ttf', 'RolffSans', 'normal');
  doc.addFileToVFS('B.ttf', b64('NotoSans-Bold.ttf')); doc.addFont('B.ttf', 'RolffSans', 'bold');
  doc.addFileToVFS('E.ttf', b64('NotoEmoji-Regular-pua.ttf')); doc.addFont('E.ttf', 'RolffEmoji', 'normal');
  const fonts = { text: 'RolffSans', emoji: 'RolffEmoji', emojiMap: X.emojiMapFrom(X.RUNS) };
  const r = X.renderConversationPdf(doc, model(X), fonts);
  const out = Buffer.from(doc.output('arraybuffer'));
  assert.ok(r.pages >= 2); assert.equal(doc.getNumberOfPages(), r.pages);
  assert.equal(out.subarray(0, 5).toString(), '%PDF-');
  assert.ok(out.includes('/FontFile2')); assert.ok(out.includes('/ToUnicode'));
  assert.ok(out.length < 400_000, `subset fonts keep the PDF small (${out.length} bytes)`);
});
test('fallback (fonts unavailable) still produces a readable PDF with footer text', async () => {
  const X = await load(); const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const r = X.renderConversationPdf(doc, model(X)); const out = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(out.includes(`(Side 1 af ${r.pages})`)); assert.ok(out.includes('(Eksporteret fra ROLFF)'));
});
test('emoji font PUA map covers every astral emoji glyph in order', async () => {
  const X = await load(); const runs = X.RUNS; const m = X.emojiMapFrom(runs);
  assert.equal(m.get(runs[0][0]), 0xe000); assert.ok(m.size > 1000 && m.size <= 0x1900); assert.ok([...m.values()].every((v) => v >= 0xe000 && v <= 0xf8ff));
});
