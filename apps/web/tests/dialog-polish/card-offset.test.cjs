// In-chat cards: ONE shared top offset directly under the chat header, and no card can fold into a strip when the
// mobile keyboard shrinks the visible viewport. Synthetic only (mocked Supabase, jsdom: header has no layout, so the
// header bottom is the 56px fallback and the shared card top is 56 + 8 = 64px).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, label, click } = require('../back-navigation/support.cjs');
const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');

function menuItem(d, text) {
  const b = [...d.querySelectorAll('.menu button')].find(el => (el.querySelector('.menu-label')?.textContent || el.textContent).trim() === text);
  assert.ok(b, 'menu item: ' + text);
  return b;
}
async function openMenuItem(d, text) { await click(label(d, 'Menu')); await click(menuItem(d, text)); await delay(60); }
function cardTop(d) {
  const dlg = d.querySelector('dialog[open]');
  if (dlg) return dlg.style.top;
  const ov = [...d.querySelectorAll('.overlay')].at(-1);
  assert.ok(ov && ov.classList.contains('top-overlay'), 'in-chat card hangs under the header (top-overlay)');
  return ov.style.paddingTop;
}
async function closeCard(w, d) {
  const x = d.querySelector('dialog[open] button[aria-label="Luk"], .overlay button[aria-label="Luk"]');
  assert.ok(x, 'X close'); await click(x); await delay(60);
}

test('every card from the in-chat ⋮ menu uses the same top offset under the chat header', { timeout: 30000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn')); await delay(60);
    if (!d.querySelector('.topbar.chat')) { await click(d.querySelector('.convbtn')); await delay(60); }
    assert.ok(d.querySelector('.topbar.chat'), 'chat open');
    const tops = {};
    for (const item of ['Slå notifikationer fra', 'Modtagetider', 'Beskedfrekvens', 'Kontaktens kaldenavn', 'Eksportér samtale', 'Rapportér', 'Blokér samtale']) {
      await openMenuItem(d, item);
      tops[item] = cardTop(d);
      await closeCard(w, d);
    }
    assert.deepEqual(new Set(Object.values(tops)), new Set(['64px']), JSON.stringify(tops));
    // Blokeringer is a SheetView like Beskedfrekvens/Rapportér (this fixture has no VITE_SUPABASE_* for its RPCs).
    assert.match(src('App.tsx'), /sheet === "words" && <SheetView title=\{da \? "Blokeringer"/);
  } finally { await fx.close(); }
});

test('front-page cards keep their usual place (no in-chat offset)', { timeout: 10000 }, async () => {
  const fx = await env(false); const { d } = fx;
  try {
    await openMenuItem(d, 'App-sprog');
    assert.ok(!d.querySelector('.overlay.top-overlay'));
  } finally { await fx.close(); }
});

test('keyboard open: the shared top moves up only as much as needed to keep a usable card; the nickname card never collapses', () => {
  const m = src('modalLayer.ts');
  assert.match(m, /export const CHAT_CARD_GAP = 8;/);
  assert.match(m, /export const CARD_MIN_HEIGHT = 180;/);
  assert.match(m, /Math\.max\(8, Math\.min\(want, vh - CARD_MIN_HEIGHT - 12\)\)/);
  assert.match(m, /maxHeight: `max\(\$\{CARD_MIN_HEIGHT\}px, calc\(var\(--vv-h, 100dvh\) - \$\{top \+ 12\}px\)\)`/);
  for (const f of ['MuteDialog.tsx', 'confirmDialog.tsx', 'App.tsx']) assert.match(src(f), /paddingTop: underHeader \}/, f + ' uses the shared top as is');
  assert.doesNotMatch(src('MuteDialog.tsx'), /underHeader \+ 8/);
  assert.match(src('ContactAlias.tsx'), /style=\{chatDialogStyle\(underHeader\)\}/);
  // --vv-h is already the height ABOVE the keyboard: subtracting --kbd-inset again gave a negative max-height (the strip bug).
  const css = src('styles.css') + src('blockingLists.css') + src('native.css');
  assert.doesNotMatch(css, /var\(--vv-h[^;{}]*-\s*var\(--kbd-inset/, 'no rule subtracts the keyboard twice');
  assert.match(css, /\.overlay\.top-overlay \.sheet,\.overlay\.top-overlay \.confirm-card\{min-height:min\(180px,100%\)/);
});

test('chatCardTop clamps on a short viewport (behaviour)', async () => {
  const esbuild = require('esbuild');
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, '../../src/modalLayer.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], logLevel: 'silent' });
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div class="topbar chat"></div>');
  const g = globalThis; const keep = { window: g.window, document: g.document };
  g.window = dom.window; g.document = dom.window.document;
  try {
    const mod = { exports: {} }; new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
    const { chatCardTop, chatDialogStyle } = mod.exports;
    assert.equal(chatCardTop(844), 64, 'normal: header + 8');
    assert.equal(chatCardTop(420), 64, 'keyboard, enough room: unchanged');
    assert.equal(chatCardTop(230), 38, 'very short: moves up to keep 180px');
    assert.equal(chatCardTop(100), 8, 'never above 8px');
    assert.equal(chatDialogStyle(null), undefined);
    assert.equal(chatDialogStyle(64).top, 64);
    dom.window.document.querySelector('.topbar').remove();
    assert.equal(chatCardTop(844), null, 'front page');
  } finally { g.window = keep.window; g.document = keep.document; }
});

test('App-sprog / App language, and a FAQ entry on writing in several languages (no model or provider names)', () => {
  const i18n = src('i18n.ts'), app = src('App.tsx');
  assert.match(i18n, /lang: "App-sprog"/); assert.match(i18n, /lang: "App language"/);
  assert.doesNotMatch(i18n, /lang: "Sprog"|lang: "Language"/);
  const da = app.match(/\["Hvilke sprog kan jeg skrive på\?", "([^"]+)"\]/), en = app.match(/\["Which languages can I write in\?", "([^"]+)"\]/);
  assert.ok(da && en, 'FAQ entry in da and en');
  assert.match(da[1], /blander flere sprog i samme besked eller endda i samme sætning/); assert.match(da[1], /mest præcist, når du holder dig til ét sprog/);
  assert.match(en[1], /mixing several languages in the same message or even the same sentence/); assert.match(en[1], /stick to one language/);
  for (const a of [da[1], en[1]]) assert.doesNotMatch(a, /OpenAI|ChatGPT|GPT|Gemini|Google|Luna/);
});
