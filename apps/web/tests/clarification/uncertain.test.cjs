// Borderline tone ("uncertain"): Rolff blocks, says briefly that the tone is uncertain, highlights the
// doubtful words and offers "Brug forslaget" exactly like a normal block. Synthetic text, mocked sends only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(30); };
const DA = 'Rolff er lidt i tvivl om, hvordan beskeden vil blive opfattet. Prøv at skrive den lidt anderledes.';
const EN = "Rolff isn't quite sure how this will come across. Try rephrasing it.";
const MSG = 'Hvorfor tog du ikke de skodbøger med?';
const RES = { status: 'blocked', reason_code: 'uncertain', spans: ['skodbøger'], suggestion: 'Hvorfor tog du ikke bøgerne med?' };
async function setEnglish(d) {
  await click(label(d, 'Menu')); const it = [...d.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === 'Sprog'); await click(it); await delay(60);
  const en = [...d.querySelectorAll('.sheet .choice')].find(c => c.textContent.includes('English')); await click(en.querySelector('input')); await delay(40);
  const x = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]'); if (x) await click(x); await delay(40);
}
async function send(f, response, en = false) {
  const { w, d } = f; await click(button(d, 'kontakt@example.invalid'));
  w.QA.setNextSend(response); await put(w, label(d, en ? 'Write a message' : 'Skriv en besked'), MSG);
  await click(label(d, en ? 'Send message' : 'Send besked')); await delay(80);
  return d.querySelector('.blockbox');
}
const noPronoun = t => !/\b(Luna|hun|hende|han|ham|she|her|he|him)\b/i.test(t);

test('da: uncertain shows the fixed Rolff text, highlights the span and offers Brug forslaget', async () => {
  const f = await env(); const { d } = f; try {
    const box = await send(f, { ...RES, explanation: DA });
    assert.ok(box); assert.equal(box.querySelector('.blockbox-head strong').textContent, 'Ikke sendt');
    const reason = box.querySelector('.blockbox-reason'); assert.equal(reason.textContent, `Beskeden blev ikke sendt. ${DA}`);
    assert.ok(!reason.textContent.includes('Ret den og prøv igen'));
    assert.equal(box.querySelector('.blockbox-flag mark').textContent, 'skodbøger');
    assert.equal(box.querySelector('.blockbox-quote').textContent, 'Hvorfor tog du ikke bøgerne med?');
    const use = box.querySelector('.blockbox-use'); assert.equal(use.textContent, 'Brug forslaget');
    assert.ok(noPronoun(box.textContent), box.textContent);
    await click(use); await delay(30); assert.equal(label(d, 'Skriv en besked').value, 'Hvorfor tog du ikke bøgerne med?');
  } finally { await f.close(); }
});

test('da: the client shows the Rolff text even if the server explanation is missing or different', async () => {
  for (const explanation of [undefined, 'Noget andet fra modellen.']) {
    const f = await env(); try {
      const r = { ...RES }; if (explanation) r.explanation = explanation;
      const box = await send(f, r); assert.equal(box.querySelector('.blockbox-reason').textContent, `Beskeden blev ikke sendt. ${DA}`);
    } finally { await f.close(); }
  }
});

test('da: no span/suggestion from the model -> still blocked with the Rolff text, no highlight, no button, no guidance', async () => {
  const f = await env(); try {
    const box = await send(f, { status: 'blocked', reason_code: 'uncertain', spans: [], suggestion: '', explanation: DA });
    assert.ok(box); assert.match(box.textContent, /Rolff er lidt i tvivl/);
    assert.equal(box.querySelector('.blockbox-flag'), null); assert.equal(box.querySelector('.blockbox-use'), null); assert.equal(box.querySelector('.blockbox-guide'), null);
  } finally { await f.close(); }
});

test('en: uncertain shows the English Rolff text with highlight and Use suggestion', async () => {
  const f = await env(); const { d } = f; try {
    await setEnglish(d);
    const box = await send(f, { ...RES, explanation: EN }, true);
    assert.ok(box); assert.equal(box.querySelector('.blockbox-head strong').textContent, 'Not sent');
    assert.equal(box.querySelector('.blockbox-reason').textContent, `The message was not sent. ${EN}`);
    assert.equal(box.querySelector('.blockbox-flag mark').textContent, 'skodbøger');
    assert.ok(box.querySelector('.blockbox-use')); assert.ok(noPronoun(box.textContent), box.textContent);
  } finally { await f.close(); }
});

test('other reasons are unchanged (explanation + retry line)', async () => {
  const f = await env(); try {
    const box = await send(f, { status: 'blocked', reason_code: 'personal_attack', spans: [], suggestion: '', explanation: 'Tonen kan virke hård.' });
    assert.equal(box.querySelector('.blockbox-reason').textContent, 'Beskeden blev ikke sendt. Tonen kan virke hård. Ret den og prøv igen.');
    assert.ok(box.querySelector('.blockbox-guide'));
  } finally { await f.close(); }
});
