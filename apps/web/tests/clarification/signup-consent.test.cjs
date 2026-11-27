// Signup consent: 18+ checkbox, privacy policy link, AI consent metadata. Synthetic only; no real accounts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, click } = require('./support.cjs');

const put = async (w, el, v) => {
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  await delay(20);
};

test('signup shows age, AI consent and a privacy-policy link, and sends metadata on submit', async () => {
  const f = await env();
  const { d, w } = f;
  try {
    w.QA.changeUser(null);
    await delay(60);
    await click(button(d, 'Opret konto'));
    await delay(40);
    const text = d.querySelector('.card').textContent;
    assert.match(text, /Jeg er fyldt 18 år/);
    assert.match(text, /30 dage til misbrugskontrol/);
    assert.doesNotMatch(text, /gemning slået fra|OpenAI|Luna|store:false/i);
    const policy = [...d.querySelectorAll('a')].find(a => a.getAttribute('href') === './privatliv.html');
    assert.ok(policy, 'privacy policy link');
    assert.equal(policy.textContent.trim(), 'Privatlivspolitik');
    assert.equal(policy.getAttribute('target'), '_blank');

    w.QA.calls.length = 0;
    d.querySelector('form').requestSubmit();
    await delay(40);
    assert.equal(w.QA.calls.filter(c => c.auth === 'signUp').length, 0, 'blocked until checkboxes are ticked');

    const boxes = [...d.querySelectorAll('.card input[type=checkbox]')];
    assert.equal(boxes.length, 3);
    for (const b of boxes) { b.click(); await delay(10); }
    await put(w, d.querySelector('#e'), 'ny@example.invalid');
    await put(w, d.querySelector('#p'), 'correct-horse-1');
    await put(w, d.querySelector('#p2'), 'correct-horse-1');
    d.querySelector('form').requestSubmit();
    await delay(40);
    const up = w.QA.calls.find(c => c.auth === 'signUp');
    assert.ok(up, 'signUp called');
    assert.equal(up.args.email, 'ny@example.invalid');
    assert.equal(up.args.options.data.ai_consent, true);
    assert.equal(up.args.options.data.age_18, true);
  } finally { await f.close(); }
});
