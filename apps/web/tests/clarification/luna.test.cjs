const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
const fs = require('node:fs'); const path = require('node:path');
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(30); };
for (const outcome of ['accepted', 'clarification_required']) test(`Luna robot shows while checking and disappears after (${outcome})`, async () => {
  const f = await env(); const { w, d } = f;
  try {
    await click(button(d, 'kontakt@example.invalid'));
    assert.equal(d.querySelector('.luna-evaluating'), null, 'no indicator before sending');
    w.QA.holdSends();
    await put(w, label(d, 'Skriv en besked'), 'Det passer fint, vi ses fredag.');
    await click(label(d, 'Send besked'));
    const box = d.querySelector('.luna-evaluating');
    assert.ok(box, 'indicator visible while checking');
    assert.ok(box.classList.contains('luna-in-composer'), 'robot lives inside composer surface');
    assert.ok(d.querySelector('.composer-entry.has-luna.is-checking .luna-evaluating'), 'inside composer-entry while checking');
    assert.equal(box.getAttribute('role'), 'status'); assert.equal(box.getAttribute('aria-live'), 'polite');
    assert.match(box.textContent, /Tjekker/);
    assert.match(box.querySelector('.luna-check-text')?.textContent ?? '', /Det passer fint, vi ses fredag/);
    const robot = box.querySelector('svg.luna-robot.luna-robot--checking');
    assert.ok(robot, 'robot svg rendered'); assert.equal(robot.getAttribute('aria-hidden'), 'true');
    assert.equal(robot.querySelectorAll('.lr-eyes ellipse').length, 2, 'two eyes');
    assert.equal(robot.querySelectorAll('.lr-dot').length, 3, 'three loading dots');
    assert.equal(box.querySelector('.luna-moon, .luna-orbit'), null, 'old moon is gone');
    assert.equal(d.querySelectorAll('.luna-evaluating').length, 1);
    assert.ok(d.querySelector('.composer-fields').disabled, 'composer locked while checking');
    assert.equal(d.querySelector('.msgs + .luna-evaluating'), null, 'no separate card between messages and composer');
    w.QA.releaseSends(outcome); await delay(60);
    assert.equal(d.querySelector('[role="status"].luna-evaluating'), null, 'checking status gone after result');
    assert.equal(d.querySelectorAll('.luna-evaluating').length <= 1, true);
    if (outcome === 'accepted') {
      const done = d.querySelector('.luna-done');
      assert.ok(done && done.getAttribute('aria-hidden') === 'true' && done.querySelector('svg.luna-robot--happy'), 'brief visual-only happy robot');
      assert.ok(done.classList.contains('luna-in-composer'), 'happy state also inside composer');
      assert.equal(done.textContent.trim(), '');
      assert.equal(d.querySelector('.composer-fields').disabled, false, 'happy state does not block composer');
      assert.equal(label(d, 'Skriv en besked').value, '', 'accepted send clears composer immediately');
      const flashed = d.querySelector('.msg.mine.just-accepted');
      assert.ok(flashed, 'just-approved own bubble flashes');
      assert.match(flashed.textContent, /Det passer fint, vi ses fredag/);
      assert.equal(d.querySelectorAll('.msg.just-accepted').length, 1, 'only one bubble flashes');
      assert.equal(d.querySelector('.msg.just-accepted:not(.mine)'), null, 'never flash their bubbles');
      await delay(1250);
      assert.equal(d.querySelector('.msg.just-accepted'), null, 'flash class clears after pulse');
    } else assert.equal(d.querySelector('.luna-done'), null, 'no happy state when not accepted');
    assert.equal(d.querySelector('.luna-evaluating'), null, 'indicator fully gone');
    assert.equal(d.querySelector('.msg.just-accepted'), null, 'no flash when not accepted or after clear');
    assert.equal(w.QA.calls.filter(c => c.function === 'send-message').length, 1);
  } finally { await f.close(); }
});

test('approval flash CSS is soft (no scale/bounce) and respects reduced motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/lunaRobot.css'), 'utf8');
  assert.match(css, /\.msg\.just-accepted\{[^}]*animation:\s*msg-accept-glow\s*\.72s\s*ease-out/);
  assert.match(css, /@keyframes msg-accept-glow/);
  assert.doesNotMatch(css.split('@keyframes msg-accept-glow')[1].split('@keyframes')[0], /scale\(|translateY\([^0]|bounce/i);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]*msg-accept-soft/);
  assert.match(css, /\.luna-in-composer/);
});

test('history bubbles do not flash on initial conversation open', async () => {
  const f = await env(); const { d } = f;
  try {
    await click(button(d, 'kontakt@example.invalid'));
    await delay(40);
    assert.ok(d.querySelector('.msg.mine'), 'seed message visible');
    assert.equal(d.querySelector('.msg.just-accepted'), null, 'no flash on load');
  } finally { await f.close(); }
});
