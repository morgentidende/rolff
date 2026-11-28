// "Behold mine beskeder i": keep-until-I-delete is the default and first choice; shorter times are optional;
// the text under the dropdown explains the 3-day warning and PDF export. Synthetic data only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { env, delay, label, click } = require('./support.cjs');
const APP = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
const items = (d) => [...d.querySelectorAll('[role=menuitem]')];
async function openItem(d, text) {
  await click(label(d, 'Menu')); const it = items(d).find(b => b.textContent.trim() === text); assert.ok(it, `menu item ${text}`);
  await click(it); await delay(80); const s = d.querySelector('.sheet'); assert.ok(s, `${text} sheet`); return s;
}

test('dropdown (da): "Indtil jeg sletter dem (standard)" is first and selected by default; 5 år and 1 år are optional', async () => {
  const f = await env(); const { d } = f; try {
    const s = await openItem(d, 'Privatliv og sletning');
    assert.match(s.textContent, /Behold mine beskeder i/);
    const sel = s.querySelector('select#ret'); assert.ok(sel);
    assert.deepEqual([...sel.options].map(o => [o.value, o.textContent]), [['unlimited', 'Indtil jeg sletter dem (standard)'], ['5y', '5 år'], ['1y', '1 år']]);
    assert.equal(sel.value, 'unlimited');
    assert.ok(!/1 år \(standard\)|Ubegrænset/.test(s.textContent), 'old default label is gone');
  } finally { await f.close(); }
});

test('text under the dropdown (da): kept until I delete them, shorter is optional, 3-day warning, PDF export, other party keeps their copy', async () => {
  const f = await env(); const { d } = f; try {
    const s = await openItem(d, 'Privatliv og sletning');
    const txt = [...s.querySelectorAll('p.meta')].map(p => p.textContent).find(t => /gemmes dine beskeder/.test(t)); assert.ok(txt, 'explanation');
    for (const part of ['indtil du selv sletter dem eller din konto', 'Vælger du en kortere tid', 'beholder de deres kopi', '3 dage før', 'mail', 'notifikation', 'eksportere samtalen som PDF', 'Eksportér samtale', 'længere tid'])
      assert.ok(txt.includes(part), part);
    assert.ok(!/OpenAI|Gemini|ChatGPT|Luna/i.test(txt));
  } finally { await f.close(); }
});

test('choosing a shorter time saves exactly that choice; choosing the default again saves unlimited', async () => {
  const f = await env(); const { d, w } = f; try {
    const s = await openItem(d, 'Privatliv og sletning');
    const sel = s.querySelector('select#ret');
    const set = async (v) => { sel.value = v; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await delay(60); };
    const calls = w.QA.calls;
    await set('1y'); await set('unlimited');
    const saved = calls.filter(c => c.name === 'set_my_data_prefs').map(c => c.args.p_retention);
    assert.equal(JSON.stringify(saved.slice(-2)), JSON.stringify(['1y', 'unlimited']));
  } finally { await f.close(); }
});

test('source: English labels, explanation and the new FAQ item exist in da and en without provider names', () => {
  for (const part of ['Until I delete them (default)', 'Indtil jeg sletter dem (standard)', 'By default your messages are kept until you delete them or your account', 'Are my old messages deleted automatically?', 'Bliver mine gamle beskeder slettet automatisk?', '3 days before the first messages disappear', '3 dage før de første beskeder forsvinder', 'export the conversation as a PDF'])
    assert.ok(APP.includes(part), part);
  const faq = APP.slice(APP.indexOf('function Faq'), APP.indexOf('export const evidenceNote'));
  assert.doesNotMatch(faq.slice(faq.indexOf('Bliver mine gamle'), faq.indexOf('Bliver mine gamle') + 900), /OpenAI|ChatGPT|Gemini|Grok|Claude/i);
});
