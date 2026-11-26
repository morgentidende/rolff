// Modal backdrop behaviour: the page behind a card is inactive and blurred, a tap outside only closes the card.
// Synthetic only (mocked Supabase, jsdom). jsdom has no hit-testing, so `tap` models a browser tap: pointerdown,
// pointerup and click each go to whatever is topmost at that moment (the backdrop while it exists, else the chat row).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const { env, delay, button, label, click } = require('../back-navigation/support.cjs');
const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');

const TOP = '.confirm-overlay,.message-overlay,.menu-scrim,.overlay,dialog[open]';
function installHitTest(w, d, behind) {
  d.elementFromPoint = () => { const all = d.querySelectorAll(TOP); return all.length ? all[all.length - 1] : behind(); }; // topmost = last in DOM order
}
async function tap(w, d, gap = 0) {
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    const target = d.elementFromPoint(200, 400);
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { isPrimary: true, button: 0, clientX: 200, clientY: 400, pointerId: 1, pointerType: 'touch' });
    target.dispatchEvent(e);
    if (gap) await delay(gap);
  }
  await delay(30);
}
const chatOpen = d => !!d.querySelector('.topbar.chat');

test('Tema card: a tap on the dimmed background only closes the card, the chat behind never opens', { timeout: 10000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    installHitTest(w, d, () => d.querySelector('.convbtn'));
    await click(label(d, 'Menu')); await click(button(d, 'Tema'));
    const overlay = d.querySelector('.overlay.anchored-overlay'); assert.ok(overlay && d.querySelector('.sheet'), 'Tema card is open over the chat list');
    assert.ok(d.documentElement.classList.contains('modal-open'), 'background scroll is locked');
    assert.ok(d.querySelector('.convbtn').closest('[inert]'), 'the chat list behind is inactive (inert)');
    assert.ok(!overlay.closest('[inert]') && !d.querySelector('.sheet').closest('[inert]'), 'the card itself stays active');
    // pointerdown alone must not close the card: that used to remove the backdrop before the click landed on the chat row.
    overlay.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    await delay(30);
    assert.ok(d.querySelector('.sheet'), 'pressing the backdrop does not dismiss yet');
    overlay.dispatchEvent(new w.Event('pointerup', { bubbles: true }));
    await tap(w, d);
    assert.ok(!d.querySelector('.sheet'), 'tap outside closes the card');
    assert.ok(!chatOpen(d), 'the chat under the tap did NOT open');
    assert.ok(!w.QA.calls.some(c => /message|conversation_events/i.test(c.name) && c.after), 'nothing was loaded for a chat');
    assert.ok(!d.querySelector('[inert]'), 'background is active again after close');
    assert.ok(!d.documentElement.classList.contains('modal-open'), 'scroll lock released');
    // The next, deliberate tap on the chat row works.
    await click(d.querySelector('.convbtn')); assert.ok(chatOpen(d));
  } finally { await fx.close(); }
});

test('a tap that starts inside the card and ends on the backdrop does not dismiss, and never reaches the page', { timeout: 10000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    installHitTest(w, d, () => d.querySelector('.convbtn'));
    await click(label(d, 'Menu')); await click(button(d, 'Tema'));
    const overlay = d.querySelector('.overlay');
    d.querySelector('.sheet').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    overlay.click(); await delay(30);
    assert.ok(d.querySelector('.sheet'), 'drag-out release is not a backdrop tap');
    assert.ok(!chatOpen(d));
  } finally { await fx.close(); }
});

test('dropdown menu: outside tap closes it through a scrim and never activates the page behind', { timeout: 10000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    installHitTest(w, d, () => d.querySelector('.convbtn'));
    await click(label(d, 'Menu'));
    assert.ok(d.querySelector('.menu'), 'menu open'); assert.ok(d.querySelector('.menu-scrim'), 'scrim sits behind the menu');
    assert.ok(d.querySelector('.convbtn').closest('[inert]'), 'page behind the menu is inert');
    assert.ok(!d.querySelector('.menu').closest('[inert]'), 'menu items stay active');
    await tap(w, d);
    assert.ok(!d.querySelector('.menu') && !d.querySelector('.menu-scrim'), 'closed');
    assert.ok(!chatOpen(d), 'chat did not open');
    assert.ok(!d.querySelector('[inert]'));
  } finally { await fx.close(); }
});

test('stacked layers: confirm over a sheet keeps both backgrounds inactive and restores them one by one; Tab stays in the card', { timeout: 10000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    installHitTest(w, d, () => d.querySelector('.convbtn'));
    await click(label(d, 'Menu')); await click(button(d, 'Tema'));
    const sheetOverlay = d.querySelector('.overlay');
    // Tab trap: from the last control, Tab wraps to the first; Shift+Tab from the first wraps to the last.
    const f = [...sheetOverlay.querySelectorAll('button,input,select')].filter(x => !x.disabled);
    f[f.length - 1].focus();
    const tab = (el, shift) => { const e = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
    assert.ok(tab(d.activeElement, false)); assert.ok(d.activeElement === f[0], 'Tab wraps inside the card');
    assert.ok(tab(d.activeElement, true)); assert.ok(d.activeElement === f[f.length - 1], 'Shift+Tab wraps inside the card');
    let ok = null;
    w.dispatchEvent(new w.CustomEvent('rolff:confirm', { detail: { title: 'Sikker?', confirm: 'Ja', cancel: 'Nej', resolve: v => { ok = v; } } })); await delay(30);
    const confirm = d.querySelector('.confirm-overlay'); assert.ok(confirm);
    assert.ok(sheetOverlay.closest('[inert]') || sheetOverlay.hasAttribute('inert'), 'the sheet under the confirm is inactive');
    assert.ok(!confirm.closest('[inert]'), 'the confirm is active');
    await tap(w, d); // backdrop of the confirm cancels the confirm only
    assert.equal(ok, false); assert.ok(!d.querySelector('.confirm-overlay'));
    assert.ok(d.querySelector('.sheet'), 'sheet is still open'); assert.ok(!sheetOverlay.hasAttribute('inert') && !sheetOverlay.closest('[inert]'), 'sheet active again');
    assert.ok(d.querySelector('.convbtn').closest('[inert]'), 'page still inert while the sheet is open');
    assert.ok(d.documentElement.classList.contains('modal-open'));
    assert.ok(!chatOpen(d));
  } finally { await fx.close(); }
});

test('message long-press menu: backdrop tap closes it without activating the chat header behind', { timeout: 10000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn'));
    const behind = () => label(d, 'Tilbage');
    installHitTest(w, d, behind);
    let backs = 0; behind().addEventListener('click', () => { backs++; }, true);
    d.querySelector('.msg')?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await delay(30);
    if (!d.querySelector('.message-overlay')) { await delay(30); }
    const ov = d.querySelector('.message-overlay');
    assert.ok(ov, 'message menu opens (fixture chat has a message)');
    assert.ok(label(d, 'Tilbage').closest('[inert]'), 'chat behind the message menu is inert');
    await tap(w, d);
    assert.ok(!d.querySelector('.message-overlay'), 'menu closed'); assert.equal(backs, 0, 'Back was not triggered'); assert.ok(chatOpen(d), 'still in the chat');
  } finally { await fx.close(); }
});

test('inside a chat: Modtagetider and Lydløs hang directly under the chat header (anchored top), front page keeps its place', { timeout: 10000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    installHitTest(w, d, () => d.querySelector('.topbar.chat'));
    // Front page: the Tema card is NOT moved.
    await click(label(d, 'Menu')); await click(button(d, 'Tema'));
    assert.ok(d.querySelector('.overlay.anchored-overlay') && !d.querySelector('.top-overlay'), 'front-page card keeps its position');
    await click(label(d, 'Luk'));
    await click(d.querySelector('.convbtn')); assert.ok(chatOpen(d));
    const orig = w.Element.prototype.getBoundingClientRect;
    w.Element.prototype.getBoundingClientRect = function () { if (this.classList?.contains('topbar') && this.classList.contains('chat')) return { top: 0, bottom: 104, left: 0, right: 390, width: 390, height: 104, x: 0, y: 0, toJSON() { } }; return orig.call(this); };
    await click(label(d, 'Menu')); await click(button(d, 'Modtagetider'));
    const ov = d.querySelector('.overlay.top-overlay'); assert.ok(ov, 'Modtagetider is a top card');
    assert.equal(ov.style.paddingTop, '104px', 'it starts at the header\'s bottom edge');
    assert.ok(ov.querySelector('.sheet') && !d.querySelector('.anchored-card'));
    assert.ok(d.querySelector('.topbar.chat').closest('[inert]'), 'the chat behind is inactive');
    await tap(w, d);
    assert.ok(!d.querySelector('.sheet'), 'backdrop tap closes it'); assert.ok(chatOpen(d));
    await delay(400);
    await click(label(d, 'Menu')); await click(button(d, 'Slå notifikationer fra'));
    const mute = d.querySelector('.confirm-overlay.top-overlay'); assert.ok(mute, 'mute dialog is a top card too');
    assert.equal(mute.style.paddingTop, '112px');
    await tap(w, d); assert.ok(!d.querySelector('.confirm-overlay')); assert.ok(chatOpen(d));
    w.Element.prototype.getBoundingClientRect = orig;
  } finally { await fx.close(); }
});

test('ghost taps: after a backdrop dismissal trailing real touch events are swallowed briefly, but not a newly opened card', { timeout: 10000 }, async () => {
  const out = await esbuild.build({ entryPoints: [path.resolve(__dirname, '../../src/modalLayer.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], logLevel: 'silent' });
  const dom = new JSDOM('<!doctype html><body><button id="row">chat</button><div class="overlay" id="ov"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const m = { exports: {} };
  w.eval(`(function(module,exports,require){${out.outputFiles[0].text}})`)(m, m.exports, name => name === 'react' ? { useCallback: f => f, useLayoutEffect() { }, useRef: v => ({ current: v }) } : require(name));
  const { swallowGhostTaps, ghostConfig } = m.exports;
  ghostConfig.onlyTrusted = false; // jsdom events are never "trusted"
  let hits = 0; w.document.getElementById('row').addEventListener('click', () => { hits++; });
  w.document.getElementById('row').addEventListener('pointerdown', () => { hits++; });
  swallowGhostTaps(120);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) w.document.getElementById('row').dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true }));
  assert.equal(hits, 0, 'click-through right after close is swallowed');
  let card = 0; w.document.getElementById('ov').addEventListener('click', () => { card++; });
  w.document.getElementById('ov').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(card, 1, 'a card that opened in the meantime still receives taps');
  await delay(200);
  w.document.getElementById('row').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(hits, 1, 'normal taps work again after the short window');
  w.close();
});

test('CSS: blur with dim fallback on every backdrop, native dialogs blurred, scroll locked, reduced-transparency respected', () => {
  assert.match(css, /\.overlay,\.message-overlay,\.menu-scrim\{-webkit-backdrop-filter:blur\(6px\);backdrop-filter:blur\(6px\);overscroll-behavior:contain\}/);
  assert.match(css, /\.contact-alias-dialog::backdrop,\.composer-upgrade::backdrop,\.blocking-dialog::backdrop\{-webkit-backdrop-filter:blur\(6px\);backdrop-filter:blur\(6px\)\}/);
  assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{[^@]*:root:root:root \.overlay\.overlay\{background:rgba\(0,0,0,\.66\)\}/);
  assert.match(css, /@media \(prefers-reduced-transparency:reduce\)\{[^@]*backdrop-filter:none/);
  assert.match(css, /html\.modal-open,html\.modal-open body,:root:has\(dialog\[open\]\),:root:has\(dialog\[open\]\) body\{overflow:hidden;overscroll-behavior:none\}/);
  assert.match(css, /\.overlay,\.menu-scrim\{touch-action:none\}/);
  assert.match(css, /\.overlay\.top-overlay\{align-items:flex-start;justify-content:center;/);
  assert.match(css, /\.overlay\.top-overlay \.sheet\{width:100%;max-width:560px;max-height:100%;/, 'top card scrolls inside, limited to the visible height');
  assert.match(css, /:root:has\(\.topbar\.chat\) \.contact-alias-dialog\{inset:calc\(env\(safe-area-inset-top,0px\) \+ 60px\) auto auto 50%/, 'nickname card sits under the chat header');
});

test('source: no backdrop closes on pointerdown any more', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
  for (const f of ['App.tsx', 'confirmDialog.tsx', 'MuteDialog.tsx', 'MessageBubble.tsx'])
    assert.ok(!/e\.target === e\.currentTarget\) (close|done)\(/.test(src(f)), f + ' must dismiss at click time via useBackdropDismiss');
  assert.ok(!/document\.addEventListener\("pointerdown", off\)/.test(src('App.tsx')), 'dropdown menu no longer closes on a document pointerdown');
});


function menuItem(d, text) {
  const b = [...d.querySelectorAll('.menu button')].find(el => (el.querySelector('.menu-label')?.textContent || el.textContent).trim() === text);
  assert.ok(b, 'menu item: ' + text);
  return b;
}
async function openMenuItem(d, text) {
  await click(label(d, 'Menu')); await click(menuItem(d, text)); await delay(40);
}

async function assertBackdropCloses(w, d, name, sel, open, behind, seen) {
  installHitTest(w, d, behind);
  let hits = 0;
  const b = behind();
  const onHit = () => { hits++; };
  b?.addEventListener('click', onHit, true);
  try {
    await open();
    assert.ok(d.querySelector(sel), name + ' opened');
    const inChat = chatOpen(d);
    await tap(w, d);
    assert.ok(!d.querySelector(sel), name + ' closed on a tap outside');
    assert.equal(chatOpen(d), inChat, name + ' did not open or leave the chat underneath');
    assert.equal(hits, 0, name + ' did not click through to the page behind');
    seen.push(name);
  } finally { b?.removeEventListener('click', onHit, true); }
  await delay(400); // let swallowGhostTaps expire before the next opener taps the page
}

test('every card, sheet, dialog and menu closes on a backdrop tap; the page behind is not activated', { timeout: 60000 }, async () => {
  const seen = [];
  const fx = await env(false); const { w, d } = fx;
  try {
    const listRow = () => d.querySelector('.convbtn');
    await assertBackdropCloses(w, d, '⋮ menu', '.menu', async () => { await click(label(d, 'Menu')); await delay(20); }, listRow, seen);
    for (const [name, item] of [['Sprog', 'Sprog'], ['Tema', 'Tema'], ['FAQ', 'FAQ'], ['Abonnement', 'Abonnement'], ['Feedback', 'Feedback'], ['Konto', 'Konto (e-mail og adgangskode)'], ['Inviter person', 'Inviter person']]) {
      await assertBackdropCloses(w, d, name, '.sheet', () => openMenuItem(d, item), listRow, seen);
    }
    await assertBackdropCloses(w, d, 'Kontaktens kaldenavn', 'dialog.contact-alias-dialog[open]', async () => {
      d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await delay(40);
    }, listRow, seen);
    await assertBackdropCloses(w, d, 'color palette', '.palette', async () => { await click(d.querySelector('.dot')); await delay(30); }, listRow, seen);

    await click(d.querySelector('.convbtn')); await delay(40);
    if (!chatOpen(d)) await click(d.querySelector('.convbtn')); // a prior long-press can swallow the first click
    await delay(40);
    assert.ok(chatOpen(d), 'chat opened');
    const back = () => label(d, 'Tilbage');
    await assertBackdropCloses(w, d, 'chat ⋮ menu', '.menu', async () => { await click(label(d, 'Menu')); await delay(20); }, back, seen);
    await assertBackdropCloses(w, d, 'Slå notifikationer fra', '.mute-card', () => openMenuItem(d, 'Slå notifikationer fra'), back, seen);
    await assertBackdropCloses(w, d, 'Blokér confirm', '.confirm-card', () => openMenuItem(d, 'Blokér samtale'), back, seen);
    await assertBackdropCloses(w, d, 'Modtagetider', '.sheet', () => openMenuItem(d, 'Modtagetider'), back, seen);
    await assertBackdropCloses(w, d, 'Beskedfrekvens', '.sheet', () => openMenuItem(d, 'Beskedfrekvens'), back, seen);
    await assertBackdropCloses(w, d, 'Rapportér', '.sheet', () => openMenuItem(d, 'Rapportér'), back, seen);
    await assertBackdropCloses(w, d, 'Eksportér samtale', '.sheet', () => openMenuItem(d, 'Eksportér samtale'), back, seen);
    await assertBackdropCloses(w, d, 'Tilføj person', '.sheet', async () => { await click(label(d, 'Tilføj person')); await delay(40); }, back, seen);
    // Blokeringer inner dialogs are covered in blocking-lists/app.test.cjs (this fixture has no VITE_SUPABASE_*).
    await assertBackdropCloses(w, d, 'message menu', '.message-overlay', async () => {
      d.querySelector('.msg')?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await delay(40);
    }, back, seen);
  } finally { await fx.close(); }

  const pfx = await env(false, false, (win) => { win.__QA_PENDING = 'live'; });
  try {
    const { w, d } = pfx;
    const listRow = () => d.querySelector('.convbtn');
    await assertBackdropCloses(w, d, 'pending-invite menu', 'dialog.pending-invite-menu[open]', async () => {
      d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await delay(40);
    }, listRow, seen);
  } finally { await pfx.close(); }

  assert.ok(seen.length >= 20, 'iterated cards: ' + seen.join(', '));
});
