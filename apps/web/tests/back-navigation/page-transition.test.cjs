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
    // Compositor-only: transform and opacity. box-shadow/background-color would make Chrome run the slide on the
    // main thread, where the chat's first render froze it (the Android jerks).
    for (const a of w.__anims) for (const k of a.keyframes) assert.deepEqual(Object.keys(k).filter((p) => !['transform', 'opacity'].includes(p)), [], 'compositor-only properties');
    const sheet = d.querySelector('.page-sheet');
    assert.ok(sheet && sheet.hasAttribute('inert') && sheet.getAttribute('aria-hidden') === 'true', 'static shadowed backdrop under the incoming chat');
    const sh = w.__anims.find((a) => a.el === sheet);
    assert.equal(JSON.stringify(sh.keyframes.map((k) => k.transform)), JSON.stringify([tf(inn, 0), tf(inn, 1)]), 'backdrop moves exactly with the chat');
    await delay(PAGE_MS + 60);
    assert.equal(d.querySelector('.page-ghost'), null, 'copy removed after the slide');
    assert.equal(d.querySelector('.page-sheet'), null, 'backdrop removed after the slide');

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
    for (const a of w.__anims) for (const k of a.keyframes) assert.deepEqual(Object.keys(k).filter((p) => !['transform', 'opacity'].includes(p)), [], 'compositor-only properties (back)');
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
  assert.match(css, /\.page-ghost-forward\{z-index:-1\}\.page-ghost-back\{z-index:25;/, 'below cards (overlay z-index 30)');
  assert.match(css, /\.page-sheet\{position:fixed;inset:0;z-index:-1;/, 'backdrop under the chat, above the list copy');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.page-ghost,\.page-sheet\{display:none!important\}\}/);
  const ml = fs.readFileSync(path.join(__dirname, '../../src/modalLayer.ts'), 'utf8');
  assert.match(ml, /\.topbar\.chat:not\(\[data-ghost\] \*\)/, 'the in-chat card offset never measures the leaving copy');
});

const bubbles = (d) => [...d.querySelectorAll('.msgs .day-group')].filter((n) => !n.closest('.page-ghost'));
test('no re-render mid-slide: messages fetched during the slide are shown right after it; a reopened chat slides in with them', { timeout: 10000 }, async () => {
  const fx = await env(false, false, motion); const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn'));
    assert.ok(d.querySelector('.page-ghost'), 'sliding');
    await delay(60); // the (synthetic) fetch has answered, the slide is still running
    assert.ok(d.querySelector('.page-ghost'), 'still sliding');
    assert.equal(bubbles(d).length, 0, 'fetched messages wait for the end of the slide');
    await delay(PAGE_MS + 60);
    assert.equal(d.querySelector('.page-ghost'), null);
    assert.equal(bubbles(d).length, 1, 'messages shown right after the slide');
    assert.match(bubbles(d)[0].textContent, /Kun en opdigtet testbesked/);

    await back(w); await delay(PAGE_MS + 60);
    await click(d.querySelector('.convbtn'));
    assert.ok(d.querySelector('.page-ghost'), 'sliding again');
    assert.equal(bubbles(d).length, 1, 'reopened chat already has its messages while it slides in');
    await delay(PAGE_MS + 60);
    assert.equal(bubbles(d).length, 1);
  } finally { await fx.close(); }
});

test('CSS: the slide layers paint once and only move (no animated shadow), and are hidden for reduced motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
  const rule = (sel) => (css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}')) || [])[1] || '';
  assert.match(rule('.page-sheet'), /position:fixed/); assert.match(rule('.page-sheet'), /background:var\(--bg\)/); assert.match(rule('.page-sheet'), /box-shadow:/);
  assert.match(rule('.page-sheet'), /will-change:transform/);
  assert.doesNotMatch(rule('.page-ghost') + rule('.page-sheet'), /contain:[^;]*paint|contain:strict/, 'no paint containment (it would clip the edge shadow)');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.page-ghost,\.page-sheet\{display:none!important\}\}/);
  const src = fs.readFileSync(path.join(__dirname, '../../src/pageTransition.ts'), 'utf8');
  assert.doesNotMatch(src, /boxShadow|backgroundColor/, 'no non-composited animated properties');
});


test('no jump before or after the slide: the copy is frozen as it was on screen, the page never widens, Back keeps the list scroll', { timeout: 10000 }, async () => {
  const fx = await env(false, false, motion); const { w, d } = fx;
  try {
    // Forward: the list copy keeps the list's exact height (no re-layout in its fixed layer).
    const liveH = d.querySelector('#root > .wrap').offsetHeight;
    await click(d.querySelector('.convbtn'));
    const g = d.querySelector('.page-ghost > .wrap');
    assert.equal(g.style.height, `${liveH}px`); assert.match(g.style.minHeight, /^0(px)?$/);
    await delay(PAGE_MS + 60);
    // Back: the chat copy keeps --app-h (the chat removes it from :root when it unmounts) and its hidden parts stay hidden.
    d.documentElement.style.setProperty('--app-h', '420px');
    const live = d.querySelector('#root > .wrap');
    const hiddenIdx = [...live.children].findIndex((c) => c.classList.contains('notice'));
    if (hiddenIdx >= 0) live.children[hiddenIdx].style.display = 'none'; // what :root[data-kbd] does with the keyboard open
    await back(w);
    const gb = d.querySelector('.page-ghost > .wrap');
    assert.equal(gb.style.getPropertyValue('--app-h'), '420px');
    if (hiddenIdx >= 0) assert.equal(gb.children[hiddenIdx].style.display, 'none', 'hidden in the chat, hidden in its copy');
    await delay(PAGE_MS + 60);
  } finally { await fx.close(); }
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
  assert.match(css, /(^|\n)html,body\{overflow-x:clip\}/, 'the off-screen incoming page must not widen the layout viewport (mobile zoom-out / re-wrap)');
  const nav = fs.readFileSync(path.join(__dirname, '../../src/backNavigation.ts'), 'utf8');
  assert.match(nav, /history\.scrollRestoration="manual"/, 'the browser must not override the restored list scroll on Back');
});
