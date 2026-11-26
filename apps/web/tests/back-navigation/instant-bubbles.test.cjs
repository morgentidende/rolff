// Cold start: after a full close, a chat should slide in with cached bubbles already visible.
// Synthetic jsdom only; the encrypted cache uses an in-memory IndexedDB stand-in (same AES-GCM path).
// No real messages, network, pushes or model calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, click, back } = require('./support.cjs');
const { webcrypto } = require('node:crypto');
const PAGE_MS = 280;
const FETCH_MS = 250;
const OUT = '/workspace/rolff-instant-bubbles-qa/measurements.json';

function motion(w) {
  Object.defineProperty(w.navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14) synthetic' });
  w.__anims = [];
  w.Element.prototype.animate = function (keyframes, o) {
    let done; const finished = new Promise((r) => { done = r; });
    const rec = { el: this, keyframes, o, cancelled: false };
    w.__anims.push(rec);
    setTimeout(done, typeof o === 'number' ? o : o.duration);
    return { finished, cancel() { rec.cancelled = true; } };
  };
}

function memoryStore() { return { keys: new Map(), data: new Map() }; }

function setup(store, extra) {
  return (w) => {
    motion(w);
    // jsdom has no WebCrypto/TextEncoder; the production path uses window.crypto.subtle (AES-GCM).
    Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
    w.TextEncoder = TextEncoder;
    w.TextDecoder = TextDecoder;
    w.__ROLFF_MEMORY_IDB__ = store;
    w.__QA_MESSAGE_DELAY_MS = FETCH_MS;
    if (extra) extra(w);
  };
}

const bubbles = (d) => [...d.querySelectorAll('.msgs .day-group')].filter((n) => !n.closest('.page-ghost'));

async function timeToFirstBubble(d, btn) {
  const t0 = Date.now();
  btn.click();
  for (let i = 0; i < 100; i++) {
    if (bubbles(d).length) return Date.now() - t0;
    await delay(10);
  }
  throw new Error('no bubble appeared');
}

test('cold start without a cache: bubbles wait for the fetch and the slide', { timeout: 15000 }, async () => {
  const store = memoryStore();
  const fx = await env(false, false, setup(store));
  const { d } = fx;
  try {
    const btn = d.querySelector('.convbtn');
    assert.ok(btn);
    const ms = await timeToFirstBubble(d, btn);
    assert.ok(bubbles(d)[0].textContent.includes('Kun en opdigtet testbesked'));
    // Fetch is delayed 250ms and the slide is 280ms, so the first paint is after the slide.
    assert.ok(ms >= FETCH_MS - 20, 'uncached open should wait for the server: ' + ms);
    fx._beforeMs = ms;
    // stash on the test file via global for the second test to report
    globalThis.__ROLFF_BEFORE_MS = ms;
  } finally { await fx.close(); }
});

test('cold start with encrypted cache: bubbles are visible during the slide, then reconcile', { timeout: 20000 }, async () => {
  const store = memoryStore();
  // 1. Warm the encrypted cache in a first "session"
  const warm = await env(false, false, setup(store));
  try {
    await click(warm.d.querySelector('.convbtn'));
    await delay(PAGE_MS + FETCH_MS + 80);
    assert.equal(bubbles(warm.d).length, 1);
    assert.ok(store.data.size > 0, 'encrypted ciphertext was written');
    // Ciphertext must not contain the plaintext body
    for (const box of store.data.values()) {
      const text = Buffer.from(box.ct).toString('utf8');
      assert.equal(text.includes('Kun en opdigtet testbesked'), false, 'plaintext in store');
      assert.equal(text.includes('hemmelig'), false);
    }
  } finally { await warm.close(); }

  // 2. Full close: new JS context (empty in-memory chatCache) but the same encrypted store
  // Server now says the message is gone (deleted / expired / blocked). The cache still has it.
  const fx = await env(false, false, setup(store, (w) => { w.__QA_FIXTURE = { messages: [] }; }));
  const { d } = fx;
  try {
    // Give the list warmup a moment to decrypt before the tap (as a real cold start would, after the list appears)
    await delay(40);
    const btn = d.querySelector('.convbtn');
    btn.dispatchEvent(new fx.w.Event('pointerdown', { bubbles: true }));
    const ms = await timeToFirstBubble(d, btn);
    assert.ok(d.querySelector('.page-ghost'), 'still sliding when the first bubble is painted');
    assert.equal(bubbles(d).length, 1, 'cached bubbles visible during the slide');
    assert.match(bubbles(d)[0].textContent, /Kun en opdigtet testbesked/);
    assert.ok(ms < 120, 'cached open should paint bubbles immediately, got ' + ms + 'ms');
    globalThis.__ROLFF_AFTER_MS = ms;
    await delay(80);
    assert.ok(d.querySelector('.page-ghost'), 'still sliding');
    assert.equal(bubbles(d).length, 1, 'stale cache stays on screen during the slide (no mid-slide jump)');
    await delay(PAGE_MS + FETCH_MS);
    assert.equal(d.querySelector('.page-ghost'), null);
    assert.equal(bubbles(d).length, 0, 'server reconciliation removes a deleted message after the slide');
  } finally { await fx.close(); }

  const before = globalThis.__ROLFF_BEFORE_MS, after = globalThis.__ROLFF_AFTER_MS;
  const report = {
    unit: 'ms',
    fetchDelay: FETCH_MS,
    slideDuration: PAGE_MS,
    timeToFirstBubbleWithoutCache: before,
    timeToFirstBubbleWithCache: after,
    improvedBy: typeof before === 'number' && typeof after === 'number' ? before - after : null,
    at: new Date().toISOString(),
    note: 'jsdom synthetic cold start; first bubble is a .day-group outside the leaving page copy. Server fetch is delayed by fetchDelay on both runs.',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('MEASUREMENTS', JSON.stringify(report));
});

test('logout and account switch clear the encrypted cache', { timeout: 15000 }, async () => {
  const store = memoryStore();
  const fx = await env(false, false, setup(store, (w) => { w.__QA_MESSAGE_DELAY_MS = 0; }));
  try {
    await click(fx.d.querySelector('.convbtn'));
    await delay(PAGE_MS + 80);
    assert.ok(store.data.size > 0);
    const keysBefore = store.keys.size;
    assert.ok(keysBefore > 0);
    fx.w.QA.changeUser('10000000-0000-4000-8000-000000000099');
    await delay(40);
    assert.equal(store.data.size, 0, 'account switch wipes the store');
    assert.equal(store.keys.size, 0);
  } finally { await fx.close(); }
});
