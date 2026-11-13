// FAQ copy: sender cannot see received/read status, and the FAQ never names the model.
// Synthetic data only; no real messages or model calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, label, click } = require('./support.cjs');

const APP = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
const faqSrc = APP.slice(APP.indexOf('function Faq'), APP.indexOf('export const evidenceNote'));

const DA_Q = 'Kan jeg se, om min besked er modtaget eller læst?';
const DA_A = 'Nej. Rolff viser aldrig, om en besked er modtaget eller læst. Det er for at undgå pres og konflikter. Du ved, at beskeden er nået frem, når du får et svar.';
const EN_Q = 'Can I see if my message was received or read?';
const EN_A = 'No. Rolff never shows whether a message was received or read. That is to protect against pressure and conflicts. You know a message has arrived when you get a reply.';

function has(hay, needle, label) {
  assert.ok(hay.includes(needle), `${label} missing: ${needle.slice(0, 80)}`);
}

test('FAQ source has the receipt item in da and en, and never names the model', () => {
  has(faqSrc, DA_Q, 'da question');
  has(faqSrc, DA_A, 'da answer');
  has(faqSrc, EN_Q, 'en question');
  has(faqSrc, EN_A, 'en answer');
  has(faqSrc, 'tjekker Rolff både billedet og al tekst i det', 'da attachments');
  has(faqSrc, 'Rolff checks the image and all text in it', 'en attachments');
  assert.doesNotMatch(faqSrc, /gpt-6-luna/i);
  assert.doesNotMatch(faqSrc, /\bLuna\b/);
  assert.doesNotMatch(faqSrc, /gpt-\d/i);
});

async function openFaq(d, menuName = 'FAQ') {
  await click(label(d, 'Menu'));
  const it = [...d.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === menuName);
  assert.ok(it, `menu item ${menuName}`);
  await click(it); await delay(60);
  const s = d.querySelector('.sheet');
  assert.ok(s, 'FAQ sheet');
  return s;
}

test('FAQ sheet shows the receipt item and contains no model name (da and en)', async () => {
  const f = await env(); const { d } = f;
  try {
    const da = await openFaq(d);
    const daText = da.textContent;
    has(daText, DA_Q, 'da question in sheet');
    has(daText, DA_A, 'da answer in sheet');
    has(daText, 'tjekker Rolff både billedet og al tekst i det', 'da attachments in sheet');
    assert.doesNotMatch(daText, /gpt-6-luna/i);
    assert.doesNotMatch(daText, /\bLuna\b/);
    assert.doesNotMatch(daText, /gpt-\d/i);

    const close = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]');
    await click(close); await delay(40);

    await click(label(d, 'Menu'));
    const it = [...d.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === 'Sprog');
    await click(it); await delay(60);
    const langSheet = d.querySelector('.sheet');
    const enChoice = [...langSheet.querySelectorAll('.choice')].find(c => c.textContent.includes('English'));
    await click(enChoice.querySelector('input')); await delay(40);
    const x = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]');
    if (x) { await click(x); await delay(40); }

    const en = await openFaq(d, 'FAQ');
    const enText = en.textContent;
    has(enText, EN_Q, 'en question in sheet');
    has(enText, EN_A, 'en answer in sheet');
    has(enText, 'Rolff checks the image and all text in it', 'en attachments in sheet');
    assert.doesNotMatch(enText, /gpt-6-luna/i);
    assert.doesNotMatch(enText, /\bLuna\b/);
    assert.doesNotMatch(enText, /gpt-\d/i);
  } finally { await f.close(); }
});
