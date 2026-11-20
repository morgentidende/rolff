// Returning to the app (Android app switch) with a card open in a chat: no jump, no remount, no re-animation,
// no reload. Synthetic only: mocked Supabase, jsdom, a fake visualViewport.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const { env, delay, button, label, click } = require('../back-navigation/support.cjs');

async function load(file, extra = {}) {
  const out = await esbuild.build({ entryPoints: [path.resolve(__dirname, '../../src', file)], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], logLevel: 'silent', ...extra });
  const m = { exports: {} }; return { code: out.outputFiles[0].text, m };
}
const visibility = (d, state) => { Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => state }); };

test('chat + open card: an app switch with transient viewport sizes changes nothing (no jump, no remount, no re-animation)', { timeout: 15000 }, async () => {
  let vv;
  const fx = await env(false, false, w => {
    vv = new w.EventTarget(); Object.assign(vv, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(w, 'visualViewport', { configurable: true, value: vv });
  });
  const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn'));
    const list = d.querySelector('.msgs'); assert.ok(list, 'message list');
    await click(label(d, 'Menu')); await click(button(d, 'Modtagetider'));
    const overlay = d.querySelector('.overlay.top-overlay'), sheet = overlay.querySelector('.sheet');
    const root = d.documentElement;
    const snap = () => ({ appH: root.style.getPropertyValue('--app-h'), pad: overlay.style.paddingTop, kbd: root.dataset.kbd, cls: overlay.className + '|' + sheet.className, locked: root.classList.contains('modal-open') });
    const before = snap(); assert.equal(before.appH, '844px');
    let removed = 0, attrs = 0;
    const mo = new w.MutationObserver(recs => { for (const r of recs) { if (r.type === 'childList') for (const n of r.removedNodes) if (n === overlay || n === sheet || n.contains?.(sheet)) removed++; if (r.type === 'attributes' && (r.target === overlay || r.target === sheet) && r.attributeName !== 'data-scrolled') attrs++; } });
    mo.observe(d.body, { childList: true, subtree: true, attributes: true });
    list.scrollTop = 120;
    const scrollBefore = list.scrollTop;
    // Leave the app: hidden, the browser shrinks the viewport.
    visibility(d, 'hidden'); d.dispatchEvent(new w.Event('visibilitychange')); w.dispatchEvent(new w.Event('blur'));
    vv.height = 500; vv.dispatchEvent(new w.Event('resize')); w.dispatchEvent(new w.Event('resize'));
    await delay(60); assert.deepEqual(snap(), before, 'no change while hidden');
    // Come back: visible + focus, then a burst of transient sizes (URL bar / system bars re-appearing).
    visibility(d, 'visible'); d.dispatchEvent(new w.Event('visibilitychange')); w.dispatchEvent(new w.Event('pageshow')); w.dispatchEvent(new w.Event('focus'));
    for (const h of [700, 560, 790, 844]) { vv.height = h; vv.dispatchEvent(new w.Event('resize')); w.dispatchEvent(new w.Event('resize')); await delay(40); assert.deepEqual(snap(), before, `no jump while the viewport reports ${h}px`); }
    await delay(500);
    assert.deepEqual(snap(), before, 'and nothing changed once it settled at the old size');
    assert.equal(d.querySelector('.overlay.top-overlay'), overlay, 'same overlay element (no remount)'); assert.equal(overlay.querySelector('.sheet'), sheet);
    assert.equal(removed, 0, 'the card was never removed/re-inserted');
    assert.equal(attrs, 0, 'no class/style churn on the card (so no animation replay)');
    assert.equal(list.scrollTop, scrollBefore, 'scroll position kept');
    assert.ok(d.querySelector('.topbar.chat') && d.querySelector('.sheet'), 'still in the chat with the card open');
    // A genuine change after the settle window (keyboard) is still applied, once.
    vv.height = 420; vv.dispatchEvent(new w.Event('resize')); await delay(80);
    assert.equal(root.style.getPropertyValue('--app-h'), '420px');
    mo.disconnect();
  } finally { await fx.close(); }
});

test('afterSettle: coalesces a resume burst into one call after it, passes through otherwise', { timeout: 5000 }, async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const { code, m } = await load('viewportSettle.ts');
  w.eval(`(function(module,exports){${code}})`)(m, m.exports);
  const { afterSettle, SETTLE_MS } = m.exports;
  let n = 0; const f = afterSettle(() => { n++; });
  f(); assert.equal(n, 1, 'normal: immediate');
  w.document.dispatchEvent(new w.Event('visibilitychange')); // arms the quiet window
  f(); f(); f(); assert.equal(n, 1, 'during the window: held back');
  await new Promise(r => setTimeout(r, SETTLE_MS + 120)); assert.equal(n, 2, 'one call after the burst');
  w.close();
});

test('update check: never reloads the page while a card/dialog is open', { timeout: 5000 }, async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://synthetic.invalid/', runScripts: 'outside-only' });
  const w = dom.window; w.sessionStorage.clear();
  const { code, m } = await load('versionCheck.ts', { define: { __ROLFF_BUILD__: '"old"' } });
  w.eval(`(function(module,exports,require){${code}})`)(m, m.exports, n => require(n));
  const { checkForUpdate } = m.exports;
  const fetchImpl = async () => ({ ok: true, json: async () => ({ build: 'new' }) });
  let reloads = 0;
  w.document.documentElement.classList.add('modal-open');
  assert.equal(await checkForUpdate({ fetchImpl, reload: () => reloads++, minGapMs: 0 }), false); assert.equal(reloads, 0, 'card open: no reload on resume');
  w.document.documentElement.classList.remove('modal-open');
  assert.equal(await checkForUpdate({ fetchImpl, reload: () => reloads++, minGapMs: 0 }), true); assert.equal(reloads, 1, 'no card: reloads as before');
  w.close();
});
