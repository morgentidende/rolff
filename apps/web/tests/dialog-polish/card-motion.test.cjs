// WhatsApp-like card motion: open = fade + scale-up (CSS), close = fade + scale-down on an inert copy (exitGhost).
// Synthetic only (jsdom). In the app's jsdom tests the copy is off (motionConfig), so closes stay instant there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function load(reduced = false) {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, '../../src/modalLayer.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], logLevel: 'silent' });
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>');
  const g = globalThis; const keep = { document: g.document, window: g.window, matchMedia: g.matchMedia };
  g.document = dom.window.document; g.window = dom.window; g.matchMedia = () => ({ matches: reduced });
  const mod = { exports: {} }; new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return { m: mod.exports, d: dom.window.document, restore: () => Object.assign(g, keep) };
}

test('closing an overlay card leaves a non-interactive copy that fades out and is removed', async () => {
  const { m, d, restore } = await load();
  try {
    m.motionConfig.enabled = true;
    const root = d.getElementById('root');
    root.innerHTML = '<div class="overlay top-overlay" style="padding-top:64px"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="t"><h2 id="t">Abonnement</h2><button aria-label="Luk">✕</button><input id="x" name="x"></div></div>';
    const el = root.firstElementChild;
    const ghost = m.exitGhost(el, root);
    el.remove();
    assert.ok(ghost, 'a copy is made');
    await Promise.resolve();
    const g = d.querySelector('[data-ghost]');
    assert.ok(g && g.classList.contains('overlay'), 'copy is in place of the card');
    assert.equal(g.style.paddingTop, '64px', 'same position as the card');
    assert.ok(g.hasAttribute('inert') && g.getAttribute('aria-hidden') === 'true', 'copy is inert and hidden from screen readers');
    assert.equal(g.querySelectorAll('[id],[name],[aria-modal],[role=dialog]').length, 0, 'no duplicate ids, no modal semantics');
    assert.equal(d.querySelectorAll('[aria-modal=true]').length, 0);
    await delay(m.EXIT_MS + 80);
    assert.equal(d.querySelector('[data-ghost]'), null, 'copy removed after the close animation');
  } finally { restore(); }
});

test('no copy with reduced motion, when off, for empty or non-card elements', async () => {
  const a = await load(true);
  try {
    a.m.motionConfig.enabled = true;
    const root = a.d.getElementById('root'); root.innerHTML = '<div class="overlay"><div class="sheet">Tema</div></div>';
    assert.equal(a.m.exitGhost(root.firstElementChild, root), null, 'prefers-reduced-motion: no animation');
  } finally { a.restore(); }
  const b = await load(false);
  try {
    const root = b.d.getElementById('root');
    b.m.motionConfig.enabled = false; root.innerHTML = '<div class="overlay"><div class="sheet">Tema</div></div>';
    assert.equal(b.m.exitGhost(root.firstElementChild, root), null, 'disabled');
    b.m.motionConfig.enabled = true;
    root.innerHTML = '<span class="dotwrap"><button>A</button></span>';
    assert.equal(b.m.exitGhost(root.firstElementChild, root), null, 'not a card');
    root.innerHTML = '<div class="overlay"></div>';
    assert.equal(b.m.exitGhost(root.firstElementChild, root), null, 'empty');
    root.innerHTML = '<dialog class="contact-alias-dialog" open>Kaldenavn</dialog>';
    assert.equal(b.m.exitGhost(root.firstElementChild, root), null, 'dialog without layout (jsdom): no copy');
  } finally { b.restore(); }
});

test('CSS: every card opens with fade + scale-up, closes with fade + scale-down, backdrops fade, reduced motion off', () => {
  const css = src('styles.css');
  assert.match(css, /@keyframes rolff-card-in\{from\{opacity:0;scale:\.92\}to\{opacity:1;scale:1\}\}/);
  assert.match(css, /@keyframes rolff-card-out\{from\{opacity:1;scale:1\}to\{opacity:0;scale:\.94\}\}/);
  assert.match(css, /--card-in-ms:240ms;--card-out-ms:200ms/);
  for (const sel of ['.overlay .sheet', '.overlay.top-overlay .sheet', '.sheet.anchored-card', '.overlay .confirm-card', '.menu', '.palette', 'dialog[open]{', 'dialog[open]::backdrop{animation:rolff-fade-in'])
    assert.ok(css.includes(sel), sel);
  assert.match(css, /\.overlay,\.overlay\.confirm-overlay,\.menu-scrim,\.message-overlay\{animation:rolff-fade-in/);
  assert.match(css, /\[data-ghost\],\[data-ghost\] \*\{pointer-events:none!important\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\n  [^}]*animation:none!important\}\n  \[data-ghost\]\{display:none!important\}/);
  assert.match(src('modalLayer.ts'), /exitGhost\(el, el\.parentNode \?\? parent\)/, 'one central place: every modal layer');
});
