// Retention notice (mail link or push tap) -> Privatliv og sletning. #privacy on a cold start and a ROLFF_OPEN_PRIVACY message
// from the service worker open the user's own privacy sheet, also from inside a chat; the hash is removed. Fully synthetic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay } = require('./support.cjs');
const MOR = '20000000-0000-4000-8000-000000000003';
const fakeWorker = (w) => { const t = new w.EventTarget(); Object.defineProperty(w.navigator, 'serviceWorker', { value: t, configurable: true }); return t; };
const list = (w) => { w.__QA_PENDING = 'list'; };
const sheetTitle = (d) => d.querySelector('.sheet')?.getAttribute('aria-label') ?? d.querySelector('.sheet h2')?.textContent ?? '';
const post = async (w, sw, data) => { sw.dispatchEvent(Object.assign(new w.Event('message'), { data })); await delay(80); };

test('cold start with #privacy opens Privatliv og sletning and removes the hash', async () => {
  const e = await env(false, false, (w) => { list(w); fakeWorker(w); w.history.replaceState(null, '', '#privacy'); });
  await delay(150);
  assert.ok(e.d.querySelector('.sheet'), 'a sheet is open');
  assert.match(sheetTitle(e.d) + e.d.querySelector('.sheet').textContent, /Privatliv og sletning/);
  assert.ok(e.d.querySelector('.sheet .privacy'), 'the privacy panel is there');
  assert.equal(e.w.location.hash, '');
  await e.close();
});

test('ROLFF_OPEN_PRIVACY message opens the privacy sheet even from inside a chat; other messages and a bare "privacy" word do nothing', async () => {
  let sw;
  const e = await env(false, false, (w) => { list(w); sw = fakeWorker(w); });
  const { w, d } = e;
  await post(w, sw, { type: 'ROLFF_OPEN_CONVERSATION', c: MOR }); await delay(80);
  assert.ok(d.querySelector('.topbar.chat'), 'chat is open');
  await post(w, sw, { type: 'SOMETHING_ELSE' }); await post(w, sw, { type: 'ROLFF_OPEN_PRIVACY_X' });
  assert.ok(!d.querySelector('.sheet'));
  await post(w, sw, { type: 'ROLFF_OPEN_PRIVACY' }); await delay(80);
  assert.ok(!d.querySelector('.topbar.chat'), 'left the chat');
  assert.ok(d.querySelector('.sheet .privacy'), 'privacy sheet is open');
  await e.close();
});

test('other fragments (#privacy-x, #open=…) do not open the privacy sheet', async () => {
  const e = await env(false, false, (w) => { list(w); fakeWorker(w); w.history.replaceState(null, '', '#privacyx'); });
  await delay(120);
  assert.ok(!e.d.querySelector('.sheet'));
  await e.close();
});
