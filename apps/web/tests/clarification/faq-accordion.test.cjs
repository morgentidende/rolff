// FAQ accordion: only one topic open at a time, toggle closes, a11y and ease-in-out.
// Synthetic data only; no real messages, emails, pushes or model calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, label, click } = require('./support.cjs');

const APP = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
const faqSrc = APP.slice(APP.indexOf('function Faq'), APP.indexOf('export const evidenceNote'));

const DA_Q1 = 'Kan jeg se, om min besked er modtaget eller læst?';
const DA_Q2 = 'Kan den anden se, om jeg har læst en besked eller er online?';
const EN_Q1 = 'Can I see if my message was received or read?';
const EN_Q2 = 'Can the other person see if I read a message or am online?';

test('FAQ source is a single-open accordion with ease-in-out and reduced-motion', () => {
  assert.match(faqSrc, /aria-expanded=\{isOpen\}/);
  assert.match(faqSrc, /setOpen\(\(cur\) => \(cur === q \? null : q\)\)/);
  assert.match(faqSrc, /sheet\.scrollTop/);
  assert.match(CSS, /transition:\s*grid-template-rows\s+\.28s\s+ease-in-out/);
  assert.match(CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(CSS, /\.faq-a,\s*\.faq-q::before\{transition:none\}/);
  assert.doesNotMatch(faqSrc, /<details/);
  assert.doesNotMatch(CSS, /\.faq details/);
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

function items(sheet) {
  return [...sheet.querySelectorAll('.faq-item')];
}

function question(item) {
  return item.querySelector('button.faq-q');
}

test('FAQ opens only one topic at a time, and the open topic can be closed (da and en)', async () => {
  const f = await env(); const { d } = f;
  try {
    const da = await openFaq(d);
    const daItems = items(da);
    assert.ok(daItems.length >= 2, 'enough FAQ topics');
    for (const it of daItems) {
      const btn = question(it);
      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      assert.equal(btn.tagName, 'BUTTON');
      const panel = d.getElementById(btn.getAttribute('aria-controls'));
      assert.ok(panel, 'aria-controls points at the panel');
      assert.equal(panel.getAttribute('aria-hidden'), 'true');
      assert.ok(panel.hasAttribute('inert'));
    }

    const q1 = [...da.querySelectorAll('button.faq-q')].find(b => b.textContent.trim() === DA_Q1);
    const q2 = [...da.querySelectorAll('button.faq-q')].find(b => b.textContent.trim() === DA_Q2);
    assert.ok(q1 && q2, 'da questions');

    await click(q1); await delay(30);
    assert.equal(q1.getAttribute('aria-expanded'), 'true');
    assert.equal(q2.getAttribute('aria-expanded'), 'false');
    assert.equal(da.querySelectorAll('.faq-item.is-open').length, 1);
    assert.equal(da.querySelectorAll('button.faq-q[aria-expanded="true"]').length, 1);
    const p1 = d.getElementById(q1.getAttribute('aria-controls'));
    assert.equal(p1.getAttribute('aria-hidden'), 'false');
    assert.ok(!p1.hasAttribute('inert'));

    await click(q2); await delay(30);
    assert.equal(q1.getAttribute('aria-expanded'), 'false');
    assert.equal(q2.getAttribute('aria-expanded'), 'true');
    assert.equal(da.querySelectorAll('button.faq-q[aria-expanded="true"]').length, 1);
    assert.ok(q1.closest('.faq-item').classList.contains('is-open') === false);
    assert.ok(q2.closest('.faq-item').classList.contains('is-open'));

    await click(q2); await delay(30);
    assert.equal(q1.getAttribute('aria-expanded'), 'false');
    assert.equal(q2.getAttribute('aria-expanded'), 'false');
    assert.equal(da.querySelectorAll('button.faq-q[aria-expanded="true"]').length, 0);

    const close = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]');
    await click(close); await delay(40);

    await click(label(d, 'Menu'));
    const it = [...d.querySelectorAll('[role=menuitem]')].find(b => b.textContent.includes('App-sprog') || b.textContent.includes('App language'));
    await click(it); await delay(60);
    const langSheet = d.querySelector('.sheet');
    const enChoice = [...langSheet.querySelectorAll('.choice')].find(c => c.textContent.includes('English'));
    await click(enChoice.querySelector('input')); await delay(40);
    const x = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]');
    if (x) { await click(x); await delay(40); }

    const en = await openFaq(d, 'FAQ');
    const e1 = [...en.querySelectorAll('button.faq-q')].find(b => b.textContent.trim() === EN_Q1);
    const e2 = [...en.querySelectorAll('button.faq-q')].find(b => b.textContent.trim() === EN_Q2);
    assert.ok(e1 && e2, 'en questions');
    await click(e1); await delay(30);
    assert.equal(e1.getAttribute('aria-expanded'), 'true');
    assert.equal(en.querySelectorAll('button.faq-q[aria-expanded="true"]').length, 1);
    await click(e2); await delay(30);
    assert.equal(e1.getAttribute('aria-expanded'), 'false');
    assert.equal(e2.getAttribute('aria-expanded'), 'true');
    assert.equal(en.querySelectorAll('button.faq-q[aria-expanded="true"]').length, 1);
  } finally { await f.close(); }
});

test('FAQ: a question scrolled into view is never hidden under the sticky card header', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/styles.css'), 'utf8');
  require('node:assert/strict').match(css, /\.sheet,\.contact-alias-dialog\{scroll-padding-top:64px\}/);
  require('node:assert/strict').match(css, /\.faq-item\{scroll-margin-top:64px\}/);
});
