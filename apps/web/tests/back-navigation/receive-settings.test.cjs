const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');

test('enabling modtagetider prefills Mon-Sun 18-19 and drops the yellow empty warning', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d } = fixture;
  try {
    await click(label(d, 'Menu'));
    await click(button(d, 'Modtagetider'));
    await delay(40);
    assert.ok(d.querySelector('.times'), 'sheet shows receive settings');
    assert.equal(d.querySelectorAll('.wrow').length, 0, 'starts with no windows');
    assert.ok(![...d.querySelectorAll('.notice')].some(n => /Uden tidsrum|Without a time window/i.test(n.textContent || '')), 'no yellow empty-window warning');
    const toggle = d.querySelector('.receive-fields input[type=checkbox]');
    assert.ok(toggle);
    await click(toggle);
    assert.equal(toggle.checked, true, 'toggle on');
    assert.equal(d.querySelectorAll('.wrow').length, 7, 'default every-day window');
    const times = [...d.querySelectorAll('.wrow')].map(row => [...row.querySelectorAll('select')].map(s => s.value));
    assert.ok(times.every(t => t[1] === String(18 * 60) && t[2] === String(19 * 60)), 'each row is 18:00–19:00');
    assert.deepEqual(times.map(t => +t[0]), [1, 2, 3, 4, 5, 6, 7], 'weekdays 1–7');
    assert.ok(![...d.querySelectorAll('.notice')].some(n => /Uden tidsrum|Without a time window/i.test(n.textContent || '')), 'warning still gone after enable');
    assert.equal(button(d, 'Gem').disabled, false, 'Gem enabled with default windows');
  } finally {
    await fixture.close();
  }
});

test('Gem stays disabled when enabled with zero windows after deleting all', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d } = fixture;
  try {
    await click(label(d, 'Menu'));
    await click(button(d, 'Modtagetider'));
    await delay(40);
    await click(d.querySelector('.receive-fields input[type=checkbox]'));
    assert.equal(d.querySelectorAll('.wrow').length, 7);
    while (d.querySelector('.wrow button.rm')) {
      await click(d.querySelector('.wrow button.rm'));
    }
    assert.equal(d.querySelectorAll('.wrow').length, 0);
    const hint = [...d.querySelectorAll('.times .meta')].map(n => n.textContent || '').join(' ');
    assert.match(hint, /Tilføj mindst ét tidsrum|Add at least one time window/i);
    assert.equal(button(d, 'Gem').disabled, true);
    assert.ok(![...d.querySelectorAll('.notice')].some(n => /Uden tidsrum|Without a time window/i.test(n.textContent || '')));
  } finally {
    await fixture.close();
  }
});
