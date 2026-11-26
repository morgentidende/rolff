// Cards open at once at full size: last known data (cardCache, prefetched when the chat opens) or a full-size
// skeleton inside the card — never a tiny "Henter…" card that later jumps. Synthetic jsdom only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, button, label, click } = require('./support.cjs');

// Click a ⋮ item and look at the card in the very first committed frame (before any fetch can have answered).
async function openNow(w, d, item) {
  await click(label(d, 'Menu'));
  button(d, item).click();
  await Promise.resolve();
  const sheet = d.querySelector('.overlay .sheet');
  return { sheet, skeleton: !!sheet?.querySelector('.card-skeleton'), html: sheet?.textContent ?? '' };
}
async function closeCard(d) { d.querySelector('.overlay button[aria-label="Luk"]').click(); await delay(40); }

test('Modtagetider and Beskedfrekvens open with their content at once after the chat has opened (prefetch)', { timeout: 15000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn')); await delay(500); // the chat prefetches what its ⋮ cards show
    for (const item of ['Modtagetider', 'Beskedfrekvens']) {
      const r = await openNow(w, d, item);
      assert.ok(r.sheet, item + ' card is open');
      assert.equal(r.skeleton, false, item + ': content shown in the first frame, no skeleton');
      assert.doesNotMatch(r.html, /Henter/, item + ': no loading text');
      await delay(60); await closeCard(d);
    }
  } finally { await fx.close(); }
});

test('without cached data the card opens full size with a skeleton (no tiny loading card), then fills in', { timeout: 15000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn'));
    const r = await openNow(w, d, 'Modtagetider'); // before the 300 ms prefetch
    assert.ok(r.sheet);
    assert.ok(r.skeleton, 'skeleton in the first frame (data not there yet)');
    {
      const sk = r.sheet.querySelector('.card-skeleton');
      assert.equal(sk.getAttribute('role'), 'status');
      assert.match(sk.textContent, /Henter modtagetider…/, 'screen readers still hear the status');
      assert.equal(sk.style.minHeight, '500px', 'full card height while loading');
      assert.ok(sk.querySelectorAll('.sk-bar').length >= 10);
    }
    await delay(150);
    assert.equal(d.querySelector('.overlay .sheet .card-skeleton'), null, 'filled in');
    assert.ok(d.querySelector('.overlay .sheet .times'));
  } finally { await fx.close(); }
});

test('source: every former mini loading card uses the full-size skeleton; saving waits for a fresh read; cache per account', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
  for (const f of ['ReceiveSettings.tsx', 'PushSettings.tsx', 'ConversationExport.tsx', 'BlockingLists.tsx', 'App.tsx'])
    assert.doesNotMatch(src(f), /role="status"[^>]*>\{[^}]*"Henter( modtagetider| status| lister)?…"/, f + ' has no mini "Henter…" card');
  const rs = src('ReceiveSettings.tsx');
  assert.match(rs, /const canSave=fresh&&/); assert.match(rs, /if\(!base\|\|saving\.current\|\|loading\|\|!fresh\)return;/);
  assert.match(rs, /setConflict\(true\)/, 'edited on top of cached values + server differs → conflict, never a silent overwrite');
  const app = src('App.tsx');
  assert.match(app, /if \(!fresh\) return;/, 'plan switch waits for a fresh read');
  assert.match(app, /setCardCacheOwner\(next\)/); assert.match(app, /setCardCacheOwner\(null\)/);
  assert.match(app, /prefetchCard\(`receive:\$\{id\}`/); assert.match(app, /fetchMembers\(id\)/);
  assert.match(src('BlockingLists.tsx'), /disabled=\{busy\|\|!loaded\}/, 'blocking changes still need the fresh read');
});
