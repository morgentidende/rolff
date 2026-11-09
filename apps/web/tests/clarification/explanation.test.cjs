// Luna's per-message block explanation in the orange box. Synthetic text, mocked send responses only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(30); };
const EXPL = 'Beskeden kan virke som en anklage og gøre den anden defensiv, så det praktiske let forsvinder.';
// Standard text comes from i18n `blocked` (wording handled in a separate PR), so match its stable frame only.
const isStd = t => /^Beskeden blev ikke sendt[.,] .*Ret den og prøv igen\.$/.test(t) && !t.includes(EXPL);
async function sendText(f, response) {
  const { w, d } = f; await click(button(d, 'kontakt@example.invalid'));
  w.QA.setNextSend(response); await put(w, label(d, 'Skriv en besked'), 'Opdigtet blokeret testbesked.');
  await click(label(d, 'Send besked')); await delay(80);
  return d.querySelector('.notice[role=alert]');
}
test('text: explanation replaces the standard reason, as plain text', async () => {
  const f = await env(); try {
    const box = await sendText(f, { status: 'blocked', reason_code: 'controlling_demand', spans: [], suggestion: '', explanation: EXPL });
    assert.ok(box); const first = box.querySelector('p');
    assert.equal(first.textContent, `Beskeden blev ikke sendt. ${EXPL} Ret den og prøv igen.`);
    assert.ok(first.classList.contains('block-explained'));
    assert.ok(!/fordi tonen|ordre/.test(box.textContent));
  } finally { await f.close(); }
});
for (const [name, explanation] of [['missing', undefined], ['empty', ''], ['non-string', { x: 1 }], ['too long', 'a'.repeat(161)], ['only markup', '<b></b>']])
  test(`text: ${name} explanation falls back to the standard text`, async () => {
    const f = await env(); try {
      const r = { status: 'blocked', reason_code: 'personal_attack', spans: [], suggestion: '' }; if (explanation !== undefined) r.explanation = explanation;
      const box = await sendText(f, r); assert.ok(box); assert.ok(isStd(box.querySelector('p').textContent), box.querySelector('p').textContent);
      assert.ok(!box.querySelector('p').classList.contains('block-explained'));
    } finally { await f.close(); }
  });
test('text: HTML in an explanation is never rendered as markup', async () => {
  const f = await env(); try {
    const box = await sendText(f, { status: 'blocked', reason_code: 'other_harmful', spans: [], suggestion: '', explanation: 'Tonen kan virke hård <img src=x onerror="window.__pwned=1"> for modtageren.' });
    assert.equal(box.querySelector('img'), null); assert.equal(f.w.__pwned, undefined);
    assert.ok(!/[<>]/.test(box.textContent)); assert.match(box.textContent, /Tonen kan virke hård/);
  } finally { await f.close(); }
});
for (const explanation of [EXPL, undefined]) test(`file: ${explanation ? 'explanation shown' : 'falls back to reason text'}`, async () => {
  const f = await env(); const { w, d } = f; try {
    await click(button(d, 'kontakt@example.invalid'));
    const input = d.querySelector('input[type="file"]:not([capture])'); const fake = new w.File(['synthetic image'], 'synthetic.png', { type: 'image/png' });
    fake.arrayBuffer = async () => new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]).buffer; Object.defineProperty(input, 'files', { configurable: true, value: [fake] }); input.dispatchEvent(new w.Event('change', { bubbles: true })); await delay(30);
    w.QA.setNextSend({ status: 'blocked', reason_code: 'controlling_demand', spans: [], suggestion: '', ...(explanation ? { explanation } : {}) });
    await click(label(d, 'Send vedhæftning')); await delay(80);
    if (explanation) { assert.match(d.body.textContent, new RegExp(`Filen blev ikke sendt\\. ${explanation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); assert.ok(!d.body.textContent.includes('teksten dikterer')); }
    else assert.match(d.body.textContent, /Filen blev ikke sendt: teksten/);
  } finally { await f.close(); }
});
