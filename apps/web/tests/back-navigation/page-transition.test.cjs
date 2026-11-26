// WhatsApp-like page slide between the conversation list and a chat (src/pageTransition.ts). Synthetic jsdom only.
// Motion is switched on here (jsdom normally has it off) and Element.animate is recorded, not played.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, label, click, back } = require('./support.cjs');
const PAGE_MS = 280;

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
const outside = (d, sel) => [...d.querySelectorAll(sel)].filter((n) => !n.closest('[data-ghost]'));
const tf = (rec, i) => rec.keyframes[i].transform;

test('list → chat: the chat slides in from the right over an inert copy of the list; Back slides the list in from the left', { timeout: 10000 }, async () => {
  const fx = await env(false, false, motion); const { w, d } = fx;
  try {
    assert.ok(d.querySelector('.convbtn'));
    await click(d.querySelector('.convbtn'));
    // One real page only (no double render): the chat; the list exists only as the leaving copy.
    assert.equal(outside(d, '.topbar.chat').length, 1);
    assert.equal(outside(d, '.convlist').length, 0);
    const g = d.querySelector('.page-ghost');
    assert.ok(g && g.classList.contains('page-ghost-forward'), 'leaving list copy');
    assert.ok(g.querySelector('.convlist'), 'copy shows the list');
    assert.ok(g.hasAttribute('inert') && g.getAttribute('aria-hidden') === 'true' && g.hasAttribute('data-modal-exempt'));
    assert.equal(g.querySelectorAll('[id],[aria-modal],[role=dialog],[role=menu]').length, 0, 'no duplicate ids or modal semantics');
    const wrap = d.querySelector('#root > .wrap');
    const inn = w.__anims.find((a) => a.el === wrap), out = w.__anims.find((a) => a.el === g);
    assert.equal(tf(inn, 0), 'translate3d(100%,0,0)'); assert.equal(tf(inn, 1), 'translate3d(0,0,0)');
    assert.equal(tf(out, 1), 'translate3d(-25%,0,0)');
    assert.equal(inn.o.duration, PAGE_MS); assert.match(inn.o.easing, /cubic-bezier\(\.4,0,\.2,1\)/);
    for (const a of w.__anims) for (const k of a.keyframes) assert.deepEqual(Object.keys(k).filter((p) => !['transform', 'opacity', 'backgroundColor', 'boxShadow'].includes(p)), [], 'GPU-friendly properties only, no layout');
    await delay(PAGE_MS + 60);
    assert.equal(d.querySelector('.page-ghost'), null, 'copy removed after the slide');

    w.__anims.length = 0;
    await back(w); // Android Back / gesture
    assert.ok(outside(d, '.convbtn').length, 'the list is there at once (no empty list sliding in)');
    assert.equal(outside(d, '.topbar.chat').length, 0);
    const gb = d.querySelector('.page-ghost');
    assert.ok(gb && gb.classList.contains('page-ghost-back') && gb.querySelector('.topbar.chat'), 'leaving chat copy on top');
    const wrap2 = d.querySelector('#root > .wrap');
    const home = w.__anims.find((a) => a.el === wrap2), chat = w.__anims.find((a) => a.el === gb);
    assert.equal(tf(home, 0), 'translate3d(-25%,0,0)'); assert.equal(tf(home, 1), 'translate3d(0,0,0)');
    assert.equal(tf(chat, 1), 'translate3d(100%,0,0)', 'chat slides out to the right');
    await delay(PAGE_MS + 60);
    assert.equal(d.querySelector('.page-ghost'), null);

    // The chat's own ← does the same.
    await click(d.querySelector('.convbtn')); await delay(PAGE_MS + 60);
    w.__anims.length = 0;
    await click(label(d, 'Tilbage'));
    assert.ok(d.querySelector('.page-ghost.page-ghost-back'));
    assert.ok(outside(d, '.convbtn').length);
    await delay(PAGE_MS + 60);
    assert.equal(d.querySelector('.page-ghost'), null);
  } finally { await fx.close(); }
});

test('prefers-reduced-motion: list ↔ chat switch instantly, no copy, no animation', { timeout: 10000 }, async () => {
  const fx = await env(false, false, motion); const { w, d } = fx;
  try {
    w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
    await click(d.querySelector('.convbtn'));
    assert.ok(d.querySelector('.topbar.chat'));
    assert.equal(d.querySelector('.page-ghost'), null);
    await back(w);
    assert.ok(d.querySelector('.convbtn'));
    assert.equal(d.querySelector('.page-ghost'), null);
    assert.equal(w.__anims.length, 0);
  } finally { await fx.close(); }
});

test('source: only list taps, ← and Back animate; deep links / notifications / logout stay instant; CSS keeps the copy under cards', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.equal((app.match(/preparePage\(/g) || []).length, 2, 'openFromList + backToList only');
  assert.match(app, /open=\{openFromList\}/); assert.match(app, /back=\{backToList\}/); assert.match(app, /useBackLayer\(!!conv,backToList,"view"\)/);
  assert.match(app, /useState<ConvRow\[\] \| null>\(\(\) => homeCache\.get\(uid\)\?\.convs \?\? null\)/, 'list renders from cache on Back');
  assert.match(app, /if\(uid!==next\)\{homeCache\.clear\(\);/, 'cache never crosses accounts');
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
  assert.match(css, /\.page-ghost-forward\{z-index:-1\}\.page-ghost-back\{z-index:25\}/, 'below cards (overlay z-index 30)');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.page-ghost\{display:none!important\}\}/);
  const ml = fs.readFileSync(path.join(__dirname, '../../src/modalLayer.ts'), 'utf8');
  assert.match(ml, /\.topbar\.chat:not\(\[data-ghost\] \*\)/, 'the in-chat card offset never measures the leaving copy');
});
