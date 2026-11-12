// In-app privacy policy: same text as public/privatliv.html, app language, and Back returns to the
// previous app screen (the PWA is not closed). Synthetic data; fetch is served from the repo file.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { env, delay, button, label, click, back, assertPrivateHistory } = require('./support.cjs');
const SRC = fs.readFileSync(path.join(__dirname, '../../public/privatliv.html'), 'utf8');
function serve(w) { w.fetch = async (u) => { assert.match(String(u), /privatliv\.html$/); return { ok: true, status: 200, text: async () => SRC }; }; }
const menuItem = async (d, name) => { await click(label(d, 'Menu')); const it = [...d.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === name); assert.ok(it, name); await click(it); await delay(80); };

test('Home → Privatlivspolitik opens in-app (Danish) → Back returns to Home, app stays', async () => {
  const f = await env(); const { w, d } = f; try {
    serve(w); const href = w.location.href; const opened = []; w.open = (...a) => { opened.push(a); return null; };
    await menuItem(d, 'Privatlivspolitik');
    const v = d.querySelector('.docview'); assert.ok(v, 'in-app policy screen'); assert.equal(opened.length, 0, 'no new window/tab');
    assert.equal(v.getAttribute('aria-label'), 'Privatlivspolitik'); assert.ok(v.querySelector('[aria-label="Tilbage"]'));
    const t = v.querySelector('.policy').textContent;
    assert.match(t, /Sidst opdateret: 12\. november 2026/); assert.match(t, /UDKAST – skal gennemgås af jurist\/DPO/);
    assert.ok(!/English below|Privacy policy \(English\)|← Rolff/.test(t)); assert.ok(!v.querySelector('.policy script, .policy style, .policy img, .policy [style], .policy [onclick]'));
    assert.equal(w.history.state.__rolffBack.kind, 'guard'); assertPrivateHistory(w);
    await back(w);
    assert.equal(d.querySelector('.docview'), null, 'policy closed'); assert.ok(d.querySelector('.convbtn'), 'Home still shown');
    assert.equal(w.history.state.__rolffBack.kind, 'base'); assert.equal(w.location.href, href, 'same document, app not left');
  } finally { await f.close(); }
});

test('back arrow closes it too; English app shows only the English part', async () => {
  const f = await env(); const { w, d } = f; try {
    serve(w);
    await menuItem(d, 'Sprog'); const en = [...d.querySelectorAll('.sheet .choice')].find(c => c.textContent.includes('English')); await click(en.querySelector('input')); await delay(40);
    await click(d.querySelector('.sheet [aria-label="Close"]')); await delay(40);
    await menuItem(d, 'Privacy policy');
    const v = d.querySelector('.docview'); const t = v.querySelector('.policy').textContent;
    assert.match(t, /Privacy policy \(English\)/); assert.match(t, /DRAFT – to be reviewed by a lawyer\/DPO/); assert.ok(!/Privatlivspolitik for Rolff|Sidst opdateret/.test(t));
    assert.match(t, /Blocked topics/, 'bilingual tail section kept');
    await click(v.querySelector('[aria-label="Back"]')); await delay(60);
    assert.equal(d.querySelector('.docview'), null); assert.equal(w.history.state.__rolffBack.kind, 'base');
  } finally { await f.close(); }
});

test('conversation menu has no app-wide items; policy stays reachable from the front page', async () => {
  const f = await env(); const { w, d } = f; try {
    serve(w);
    await click(d.querySelector('.convbtn')); await delay(120); assert.ok(d.querySelector('.topbar.chat'), 'in chat');
    await click(d.querySelector('[aria-label="Menu"]'));
    const labels = [...d.querySelectorAll('[role=menuitem]')].map(b => b.textContent.trim());
    assert.ok(!labels.includes('Privatlivspolitik') && !labels.includes('Sprog'), labels.join(', '));
    await click(d.querySelector('[aria-label="Menu"]'));
    await back(w); assert.equal(d.querySelector('.topbar.chat'), null);
    await menuItem(d, 'Privatlivspolitik'); assert.ok(d.querySelector('.docview'));
    await back(w); assert.equal(d.querySelector('.docview'), null); assert.ok(d.querySelector('.convbtn'));
  } finally { await f.close(); }
});
