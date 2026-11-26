// Polished "Ikke sendt" box: short house-rule reasons shown in full, a "Forslag" row with "Brug forslag", guidance only for
// conflict-type blocks, "Mere" only for genuinely long explanations. Synthetic text, mocked sends only (no model calls).
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { env, delay, button, label, click } = require('./support.cjs');
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(30); };
const SWEAR_DA = 'Rolff lader ikke bandeord passere.', EXCL_DA = 'Rolff lader ikke udråbstegn passere.';
const SWEAR_EN = "Rolff doesn't let swear words through.", EXCL_EN = "Rolff doesn't let exclamation marks through.";
const LONG = 'Beskeden kan virke som en anklage og gøre den anden defensiv, så det praktiske let forsvinder.';
const noModel = t => !/gpt|gemini|openai|luna|grok|claude|\bmodel/i.test(t);
const noPronoun = t => !/\b(han|hun|ham|hende|he|she|him|her|his)\b/i.test(t);
async function setEnglish(d) {
  await click(label(d, 'Menu')); const it = [...d.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === 'App-sprog'); await click(it); await delay(60);
  const en = [...d.querySelectorAll('.sheet .choice')].find(c => c.textContent.includes('English')); await click(en.querySelector('input')); await delay(40);
  const x = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]'); if (x) await click(x); await delay(40);
}
async function send(f, text, response, en = false) {
  const { w, d } = f; await click(button(d, 'kontakt@example.invalid'));
  w.QA.setNextSend(response); await put(w, label(d, en ? 'Write a message' : 'Skriv en besked'), text);
  await click(label(d, en ? 'Send message' : 'Send besked')); await delay(80);
  return d.querySelector('.blockbox');
}
const reasonText = box => box.querySelector('.blockbox-reason').textContent;

test('da swear word: short reason in full, marked word, Forslag + Brug forslag puts it in the composer (user sends)', async () => {
  const f = await env(); const { w, d } = f; try {
    const msg = 'Sikke noget lort at fyre af';
    const box = await send(f, msg, { status: 'blocked', reason_code: 'other_harmful', spans: ['lort'], suggestion: 'Sikke noget at fyre af', explanation: SWEAR_DA, house: 'profanity' });
    assert.ok(box); assert.ok(box.classList.contains('blockbox-house'));
    assert.equal(box.querySelector('.blockbox-head strong').textContent, 'Ikke sendt');
    assert.equal(reasonText(box), `Beskeden blev ikke sendt. ${SWEAR_DA}`);
    assert.ok(box.querySelector('.blockbox-reason').classList.contains('open'), 'not clamped');
    assert.equal(box.querySelector('.blockbox-more'), null); assert.equal(box.querySelector('.blockbox-guide'), null);
    assert.equal(box.querySelector('.blockbox-flag-k').textContent, 'Markeret:');
    assert.equal(box.querySelector('.blockbox-flag mark').textContent, 'lort');
    assert.equal(box.querySelector('.blockbox-flag-v').textContent, msg);
    assert.equal(box.querySelector('.blockbox-sugg-k').textContent, 'Forslag');
    assert.equal(box.querySelector('.blockbox-quote').textContent, 'Sikke noget at fyre af');
    const use = box.querySelector('.blockbox-use'); assert.equal(use.textContent, 'Brug forslag');
    const sends = () => w.QA.calls.filter(c => c.function === 'send-message').length, before = sends();
    await click(use); await delay(40);
    assert.equal(label(d, 'Skriv en besked').value, 'Sikke noget at fyre af'); assert.equal(d.querySelector('.blockbox'), null);
    assert.equal(sends(), before, 'using the suggestion must not send anything');
    assert.ok(noModel(box.textContent) && noPronoun(box.textContent));
  } finally { await f.close(); }
});

test('da exclamation mark: short reason, suggestion row, no guidance', async () => {
  const f = await env(); try {
    const box = await send(f, 'Det har jeg sagt!', { status: 'blocked', reason_code: 'other_harmful', spans: ['!'], suggestion: 'Det har jeg sagt.', explanation: EXCL_DA, house: 'exclamation' });
    assert.equal(reasonText(box), `Beskeden blev ikke sendt. ${EXCL_DA}`);
    assert.equal(box.querySelector('.blockbox-flag mark').textContent, '!');
    assert.equal(box.querySelector('.blockbox-quote').textContent, 'Det har jeg sagt.'); assert.equal(box.querySelector('.blockbox-use').textContent, 'Brug forslag');
    assert.equal(box.querySelector('.blockbox-guide'), null); assert.equal(box.querySelector('.blockbox-more'), null);
  } finally { await f.close(); }
});

test('house block without a suggestion: marked text only, no suggestion row, no Vejledning', async () => {
  const f = await env(); try {
    const box = await send(f, 'Lort', { status: 'blocked', reason_code: 'other_harmful', spans: ['Lort'], suggestion: '', explanation: SWEAR_DA, house: 'profanity' });
    assert.equal(box.querySelector('.blockbox-flag mark').textContent, 'Lort');
    assert.equal(box.querySelector('.blockbox-sugg'), null); assert.equal(box.querySelector('.blockbox-use'), null);
    assert.equal(box.querySelector('.blockbox-guide'), null); assert.ok(!/Vejledning/.test(box.textContent));
  } finally { await f.close(); }
});

test('conflict-type block without a suggestion still shows Vejledning; with a suggestion it shows Forslag instead', async () => {
  const f = await env(); try {
    const box = await send(f, 'Du er altid så sur', { status: 'blocked', reason_code: 'personal_attack', spans: ['altid så sur'], suggestion: '', explanation: 'Tonen kan virke hård.' });
    assert.match(box.querySelector('.blockbox-guide').textContent, /^Vejledning: Skriv, hvad der skete/);
    assert.equal(box.querySelector('.blockbox-sugg'), null);
  } finally { await f.close(); }
  const g = await env(); try {
    const box = await send(g, 'Du er altid så sur', { status: 'blocked', reason_code: 'personal_attack', spans: [], suggestion: 'Jeg er ked af det her.', explanation: 'Tonen kan virke hård.' });
    assert.equal(box.querySelector('.blockbox-guide'), null); assert.equal(box.querySelector('.blockbox-use').textContent, 'Brug forslag');
  } finally { await g.close(); }
});

test('an unknown "house" value is ignored (treated as a conflict-type block)', async () => {
  const f = await env(); try {
    const box = await send(f, 'Opdigtet besked', { status: 'blocked', reason_code: 'personal_attack', spans: [], suggestion: '', explanation: 'Tonen kan virke hård.', house: '<b>x</b>' });
    assert.ok(!box.classList.contains('blockbox-house')); assert.ok(box.querySelector('.blockbox-guide'));
  } finally { await f.close(); }
});

function fakeLayout(w, clamped) {
  Object.defineProperty(w.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList?.contains('blockbox-reason') && !this.classList.contains('open') && clamped ? 80 : 20; } });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 20; } });
}
test('"Mere" appears only when a long model explanation is really clamped, and expands it', async () => {
  const f = await env(); const { w } = f; try {
    fakeLayout(w, true);
    const box = await send(f, 'Opdigtet blokeret testbesked.', { status: 'blocked', reason_code: 'controlling_demand', spans: [], suggestion: 'Opdigtet venligt forslag.', explanation: LONG });
    const more = box.querySelector('.blockbox-more'); assert.ok(more); assert.equal(more.textContent, 'Mere'); assert.equal(more.getAttribute('aria-expanded'), 'false');
    await click(more); assert.equal(more.getAttribute('aria-expanded'), 'true'); assert.ok(box.querySelector('.blockbox-reason.open'));
  } finally { await f.close(); }
});
test('no "Mere" for a short reason even with a suggestion, and never for house-rule blocks (even if they would clamp)', async () => {
  const f = await env(); const { w } = f; try {
    fakeLayout(w, false);
    const box = await send(f, 'Opdigtet blokeret testbesked.', { status: 'blocked', reason_code: 'controlling_demand', spans: [], suggestion: 'Opdigtet venligt forslag.', explanation: 'Tonen kan virke hård.' });
    assert.equal(box.querySelector('.blockbox-more'), null);
  } finally { await f.close(); }
  const g = await env(); try {
    fakeLayout(g.w, true);
    const box = await send(g, 'Sikke noget lort at fyre af', { status: 'blocked', reason_code: 'other_harmful', spans: ['lort'], suggestion: 'Sikke noget at fyre af', explanation: SWEAR_DA, house: 'profanity' });
    assert.equal(box.querySelector('.blockbox-more'), null); assert.ok(box.querySelector('.blockbox-reason').classList.contains('open'));
  } finally { await g.close(); }
});

for (const [name, text, res, reason] of [
  ['swear word', 'What a shit day', { spans: ['shit'], suggestion: 'What a day', explanation: SWEAR_EN, house: 'profanity' }, SWEAR_EN],
  ['exclamation mark', 'I said so!', { spans: ['!'], suggestion: 'I said so.', explanation: EXCL_EN, house: 'exclamation' }, EXCL_EN],
]) test(`en ${name}: Not sent / Flagged / Suggestion / Use suggestion`, async () => {
  const f = await env(); const { d } = f; try {
    await setEnglish(d);
    const box = await send(f, text, { status: 'blocked', reason_code: 'other_harmful', ...res }, true);
    assert.equal(box.querySelector('.blockbox-head strong').textContent, 'Not sent');
    assert.equal(reasonText(box), `The message was not sent. ${reason}`);
    assert.equal(box.querySelector('.blockbox-flag-k').textContent, 'Flagged:');
    assert.equal(box.querySelector('.blockbox-sugg-k').textContent, 'Suggestion');
    assert.equal(box.querySelector('.blockbox-use').textContent, 'Use suggestion');
    assert.equal(box.querySelector('.blockbox-guide'), null); assert.equal(box.querySelector('.blockbox-more'), null);
    assert.ok(noModel(box.textContent) && noPronoun(box.textContent), box.textContent);
  } finally { await f.close(); }
});

// ---- Style: calm warning in light and dark, readable contrast, no heavy orange frame ----
const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
const hex = h => { const m = h.replace('#', ''); const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m; return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rootVar = (sel, name) => new RegExp(`${sel}\\{[^}]*--${name}:(#[0-9a-fA-F]{3,6})`).exec(css)[1];
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
for (const [theme, bbSel] of [['light', '\\.blockbox'], ['dark', '\\[data-theme=dark\\] \\.blockbox']]) {
  test(`style (${theme}): soft warning background; title, reason, muted label, icon and marked text have good contrast`, () => {
    const bg = hex(rootVar(bbSel, 'bb-bg')), text = hex(rootVar(theme === 'light' ? ':root' : '\\[data-theme=dark\\]', 'text')), muted = hex(rootVar(theme === 'light' ? ':root' : '\\[data-theme=dark\\]', 'muted'));
    assert.ok(ratio(text, bg) >= 7, `text ${ratio(text, bg)}`);
    assert.ok(ratio(muted, bg) >= 4.5, `muted ${ratio(muted, bg)}`);
    assert.ok(ratio(hex(rootVar(bbSel, 'bb-icon')), bg) >= 3, 'icon');
    const markBg = over([245, 158, 11], theme === 'light' ? 0.30 : 0.34, bg); assert.ok(ratio(text, markBg) >= 4.5, `mark ${ratio(text, markBg)}`);
  });
}
test('style: box is not the old heavy orange frame; suggestion card and button are tap-friendly', () => {
  const rule = sel => new RegExp(`\\n${sel}\\{([^}]*)\\}`).exec(css)[1];
  assert.ok(!/var\(--warn-b\)/.test(rule('\\.blockbox')) && !/var\(--warn\)/.test(rule('\\.blockbox')));
  assert.match(rule('\\.blockbox'), /background:var\(--bb-bg\)/); assert.match(rule('\\.blockbox'), /border:1px solid var\(--bb-border\)/);
  assert.ok(!/warn-b/.test(rule('\\.blockbox-sugg')), 'suggestion card has no orange border');
  assert.match(rule('\\.blockbox-use'), /min-height:44px/);
  assert.match(css, /\.blockbox-flag mark\{background:var\(--bb-mark\)/, 'marked-word highlight kept');
});
