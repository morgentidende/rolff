// Regression: opening/closing chat search must not shift the pending-invitation card or the message list
// (it used to be inserted between the header and the card, pushing everything down ~60px and re-anchoring scroll).
// Synthetic fixture only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { env, delay, label, click } = require('./support.cjs');
test('search overlays the chat header; invite card and messages are not moved, re-mounted or re-fetched', async () => {
  const f = await env(); const { w, d } = f; try {
    await click(d.querySelector('.convbtn')); await delay(80);
    const header = d.querySelector('header.topbar.chat'); const card = d.querySelector('.pendbar');
    assert.ok(card, 'pending invite fixture shown'); assert.match(card.textContent, /Afventer godkendelse: advokat.test@example.invalid/);
    assert.ok(header.nextElementSibling === card, 'card follows the header');
    const list = d.querySelector('.msgs'); list.scrollTop = 37; const before = list.scrollTop;
    const fetches = () => w.QA.calls.filter(c => c.name === 'list_pending_invitations').length; const n = fetches();
    const btn = label(d, 'Søg i samtalen'); await click(btn); await delay(40);
    const bar = d.querySelector('.searchbar'); assert.ok(bar, 'search open');
    assert.ok(header.contains(bar), 'search bar lives inside the header row (no new row above the card)');
    assert.ok(header.nextElementSibling === card, 'nothing inserted between header and card');
    assert.ok(d.querySelector('.pendbar') === card, 'card not re-mounted');
    assert.ok(d.querySelector('.msgs') === list, 'list not re-mounted'); assert.equal(list.scrollTop, before, 'scroll kept');
    assert.equal(fetches(), n, 'no re-fetch of invitations'); assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.ok(d.activeElement === label(d, 'Søg i viste beskeder'), 'search field focused');
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay(40);
    assert.ok(d.querySelector('.searchbar') === null, 'Escape closes search');
    assert.ok(d.activeElement === btn, 'focus returns to the search button');
    assert.ok(d.querySelector('.pendbar') === card); assert.equal(list.scrollTop, before); assert.equal(fetches(), n);
    await click(btn); await delay(30); await click(label(d, 'Luk søgning')); await delay(30);
    assert.ok(d.querySelector('.searchbar') === null); assert.ok(d.activeElement === btn, 'focus back after ✕');
  } finally { await f.close(); }
});
test('search bar CSS is an overlay (absolute), never a sticky row in the column', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
  const rule = css.match(/\.searchbar\{[^}]*\}/)[0];
  assert.match(rule, /position:absolute/); assert.doesNotMatch(rule, /sticky/);
});
