// Push tap -> conversation. #open=<uuid> on a cold start and a ROLFF_OPEN_CONVERSATION message from the service worker
// open that conversation; unknown ids / non-members / malformed ids are ignored. Fully synthetic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay } = require('./support.cjs');

const MOR = '20000000-0000-4000-8000-000000000003';   // the accepted contact "Mor" in the QA list
const FAR = '20000000-0000-4000-8000-000000000001';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const fakeWorker = (w) => { const t = new w.EventTarget(); Object.defineProperty(w.navigator, 'serviceWorker', { value: t, configurable: true }); return t; };
const list = (w) => { w.__QA_PENDING = 'list'; };
const title = (d) => d.querySelector('.chattitle .contact-heading, .chattitle')?.textContent ?? '';
const chatOpen = (d) => !!d.querySelector('.topbar.chat');
const post = async (w, sw, data) => { sw.dispatchEvent(Object.assign(new w.Event('message'), { data })); await delay(60); };

test('cold start with #open=<id> opens that conversation and removes the id from the address bar', async () => {
    let sw;
    const e = await env(false, false, (w) => { list(w); sw = fakeWorker(w); w.history.replaceState(null, '', '#open=' + MOR); });
    const { w, d } = e;
    await delay(120);
    assert.ok(chatOpen(d), 'chat is open');
    assert.equal(title(d).trim().split('\n')[0].slice(0, 3), 'Mor', 'it is the Mor conversation');
    assert.equal(w.location.hash, '', 'id is not left in the URL');
    await e.close();
});

test('service worker message opens the conversation while the app is on the front page, then a second message switches to another one', async () => {
    let sw;
    const e = await env(false, false, (w) => { list(w); sw = fakeWorker(w); });
    const { w, d } = e;
    assert.ok(!chatOpen(d), 'starts on the front page');
    await post(w, sw, { type: 'ROLFF_OPEN_CONVERSATION', c: MOR }); await delay(60);
    assert.ok(chatOpen(d)); assert.ok(/^Mor/.test(title(d)));
    await post(w, sw, { type: 'ROLFF_OPEN_CONVERSATION', c: FAR }); await delay(80);
    assert.ok(!chatOpen(d), 'a conversation nobody has accepted yet has no chat: back on the front page');
    assert.ok(d.querySelector('.convrow'), 'front page');
    await e.close();
});

test('a push/link to a pending (not yet accepted) conversation lands on the front page, on cold start too', async () => {
    const e = await env(false, false, (w) => { list(w); fakeWorker(w); w.history.replaceState(null, '', '#open=' + FAR); });
    await delay(120);
    assert.ok(!chatOpen(e.d), 'no empty conversation');
    assert.ok(e.d.querySelector('.convrow'));
    assert.equal(e.w.location.hash, '');
    await e.close();
});

test('unknown conversation id (not a member), malformed ids and other message types are ignored', async () => {
    let sw;
    const e = await env(false, false, (w) => { list(w); sw = fakeWorker(w); });
    const { w, d } = e;
    await post(w, sw, { type: 'ROLFF_OPEN_CONVERSATION', c: STRANGER }); await delay(60);
    assert.ok(!chatOpen(d), 'not a member => nothing opens');
    for (const c of ['../../x', 'javascript:alert(1)', MOR + 'x', '', 5, null, {}]) await post(w, sw, { type: 'ROLFF_OPEN_CONVERSATION', c });
    await post(w, sw, { type: 'ROLFF_PUSH_CHANGED', c: MOR });
    await post(w, sw, { type: 'SOMETHING_ELSE', c: MOR });
    assert.ok(!chatOpen(d));
    await e.close();
});

test('#open with a malformed id is ignored on cold start', async () => {
    const e = await env(false, false, (w) => { list(w); fakeWorker(w); w.history.replaceState(null, '', '#open=../../etc/passwd'); });
    await delay(80);
    assert.ok(!chatOpen(e.d));
    await e.close();
});
