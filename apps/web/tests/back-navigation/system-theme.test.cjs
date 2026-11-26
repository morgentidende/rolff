// Rolff always follows the system light/dark setting, live, like WhatsApp: no Tema item, no theme select, old choice dropped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, label, click } = require('./support.cjs');

function systemDark(start) {
  return (w) => {
    w.__QA_OLD_THEME = 'light';
    let dark = start; const ls = new Set();
    const mm = (q) => ({ get matches() { return /prefers-color-scheme: dark/.test(q) ? dark : false; }, media: q, addEventListener: (_t, f) => ls.add(f), removeEventListener: (_t, f) => ls.delete(f) });
    Object.defineProperty(w, 'matchMedia', { get: () => mm, set() {}, configurable: true });
    w.__setSystemDark = (v) => { dark = v; for (const f of [...ls]) f({ matches: v }); };
  };
}

test('follows the system theme live and drops a fixed theme saved earlier; no Tema in the menu', { timeout: 10000 }, async () => {
  const fx = await env(false, false, systemDark(true)); const { w, d } = fx;
  try {
    assert.equal(d.documentElement.dataset.theme, 'dark', 'system dark wins over the old saved "light"');
    assert.equal(w.localStorage.getItem('theme'), null, 'old preference removed');
    w.__setSystemDark(false); await delay(10);
    assert.equal(d.documentElement.dataset.theme, 'light', 'switches live with the system');
    w.__setSystemDark(true); await delay(10);
    assert.equal(d.documentElement.dataset.theme, 'dark');
    await click(label(d, 'Menu'));
    const items = [...d.querySelectorAll('.menu [role=menuitem]')].map((b) => b.textContent.trim());
    assert.ok(items.includes('App-sprog'));
    assert.ok(!items.some((t) => /^(Tema|Theme)$/.test(t)), 'no Tema item: ' + items.join('|'));
  } finally { await fx.close(); }
});

test('source: no theme state, sheet, select or strings left (da+en)', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
  const app = src('App.tsx'), i18n = src('i18n.ts');
  assert.doesNotMatch(app, /setTheme|sheet === "theme"|aria-label=\{t\.theme\}|[^.\w]t\.theme\b/);
  assert.doesNotMatch(i18n, /theme: "Tema"|theme: "Theme"/);
  assert.match(app, /localStorage\.removeItem\("theme"\)/);
  assert.match(app, /mq\.addEventListener\("change", apply\)/);
  const policy = fs.readFileSync(path.join(__dirname, '../../public/privatliv.html'), 'utf8');
  assert.doesNotMatch(policy, /sprog, tema|language, theme/, 'privacy text no longer lists a stored theme');
});
