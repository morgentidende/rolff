// Rule pre-check for text emoticons: the notice names the face and asks to use words.
// Mocked send only; no model calls, no real messages.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(30); };

test('da: tekst-smiley block names the face and asks to write in words', async () => {
  const f = await env(); const { w, d } = f;
  try {
    await click(button(d, 'kontakt@example.invalid'));
    w.QA.setNextSend({ status: 'rule', rule: 'emoji', word: ':-)' });
    await put(w, label(d, 'Skriv en besked'), 'Det er fint :-)');
    await click(label(d, 'Send besked')); await delay(80);
    const note = d.querySelector('.notice[role=alert]');
    assert.ok(note);
    assert.equal(note.textContent, 'Beskeden blev ikke sendt: Tekst-smileys som :-) er ikke tilladt i Rolff. Skriv det med ord.');
    assert.equal(d.querySelector('.blockbox'), null, 'same UX as emoji: a notice, not the Luna box');
  } finally { await f.close(); }
});

test('en: text emoticon block names the face', async () => {
  const f = await env(); const { w, d } = f;
  try {
    await click(label(d, 'Menu'));
    const it = [...d.querySelectorAll('[role=menuitem]')].find(b => /App-sprog|Sprog|Language|App language/.test(b.textContent));
    assert.ok(it, 'language menu');
    await click(it); await delay(40);
    const en = [...d.querySelectorAll('.choice')].find(c => c.textContent.includes('English'));
    await click(en.querySelector('input')); await delay(40);
    const x = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]');
    if (x) await click(x); await delay(40);
    await click(button(d, 'kontakt@example.invalid'));
    w.QA.setNextSend({ status: 'rule', rule: 'emoji', word: ':(' });
    await put(w, label(d, 'Write a message'), 'Oh no :(');
    await click(label(d, 'Send message')); await delay(80);
    const note = d.querySelector('.notice[role=alert]');
    assert.equal(note.textContent, 'Not sent: text emoticons such as :( are not allowed in Rolff. Use words.');
  } finally { await f.close(); }
});
