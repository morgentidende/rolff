// Daily attachment cap: friendly da/en message when the server answers 429 daily_attachment_limit. Synthetic data only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
async function sendFile(f, response, status) {
  const { w, d } = f; await click(button(d, 'kontakt@example.invalid'));
  const input = d.querySelector('input[type="file"]:not([capture])'); const fake = new w.File(['synthetic image'], 'synthetic.png', { type: 'image/png' });
  fake.arrayBuffer = async () => new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]).buffer; Object.defineProperty(input, 'files', { configurable: true, value: [fake] }); input.dispatchEvent(new w.Event('change', { bubbles: true })); await delay(30);
  w.QA.setNextSend(response, status);
  await click(label(d, 'Send vedhæftning')); await delay(80);
}
test('429 daily_attachment_limit shows a friendly Danish message (no technical error)', async () => {
  const f = await env(); try {
    await sendFile(f, { error: 'daily_attachment_limit', limit: 5, window: 'rolling_24h' }, 429);
    const t = f.d.body.textContent;
    assert.match(t, /Du kan højst sende 5 vedhæftninger i døgnet\. Prøv igen senere\./);
    assert.ok(!/Teknisk fejl/.test(t)); assert.ok(!/daily_attachment_limit/.test(t));
  } finally { await f.close(); }
});
test('English copy for the daily limit exists and the FAQ states the cap in da + en', () => {
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(src, /You can send at most 5 attachments per 24 hours\. Try again later\./);
  assert.match(src, /Du kan sende op til 5 vedhæftninger i døgnet/); assert.match(src, /You can send up to 5 attachments per day/);
});
