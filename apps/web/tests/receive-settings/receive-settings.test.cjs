const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');

test('enabling modtagetider prefills Mon-Sun 18-19 and drops the yellow empty warning', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    w.__resetReceiveSettingsMock?.();
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

test('Gem explains (instead of silently ignoring) when enabled with zero windows', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    w.__resetReceiveSettingsMock?.();
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
    const gem = button(d, 'Gem'); assert.equal(gem.disabled, false, 'still tappable'); assert.equal(gem.getAttribute('aria-disabled'), 'true');
    const before = w.__receiveSaves ?? 0; await click(gem); assert.equal(w.__receiveSaves ?? 0, before, 'nothing saved');
    assert.ok([...d.querySelectorAll('.times [role=alert]')].some(n => /Tilføj mindst ét tidsrum/.test(n.textContent)), 'tap shows why');
    assert.ok(![...d.querySelectorAll('.notice')].some(n => /Uden tidsrum|Without a time window/i.test(n.textContent || '')));
  } finally {
    await fixture.close();
  }
});

async function openTimes(next) {
  const fixture = await env(false); const { d, w } = fixture;
  w.__resetReceiveSettingsMock?.(next);
  await click(label(d, 'Menu')); await click(button(d, 'Modtagetider')); await delay(40);
  return fixture;
}
test('overlapping windows on Gem: clear message per day, nothing saved, Slå sammen merges and Gem saves merged', { timeout: 10000 }, async () => {
  const fixture = await openTimes({ enabled: true, windows: [{ weekday: 1, start_minute: 1080, end_minute: 1140 }, { weekday: 1, start_minute: 1020, end_minute: 1200 }, { weekday: 3, start_minute: 1080, end_minute: 1140 }] });
  const { d, w } = fixture;
  try {
    const before = w.__receiveSaves ?? 0;
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves ?? 0, before, 'overlap is not saved');
    const alert = d.querySelector('.times .field-hint-block[role=alert]'); assert.ok(alert);
    assert.match(alert.textContent, /Tiderne overlapper for mandag\./);
    assert.equal(d.querySelectorAll('.wrow.needs-attention').length, 2, 'both rows highlighted');
    await click(button(d, 'Slå sammen'));
    assert.equal(d.querySelectorAll('.wrow').length, 2);
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves, before + 1);
    assert.deepEqual(JSON.parse(JSON.stringify(w.__receiveLastSave.windows)), [{ weekday: 1, start_minute: 1020, end_minute: 1200 }, { weekday: 3, start_minute: 1080, end_minute: 1140 }]);
  } finally { await fixture.close(); }
});
test('start = end is explained on Gem; overnight windows are allowed and explained', { timeout: 10000 }, async () => {
  const fixture = await openTimes({ enabled: true, windows: [{ weekday: 2, start_minute: 1200, end_minute: 1200 }, { weekday: 5, start_minute: 1320, end_minute: 120 }] });
  const { d, w } = fixture;
  try {
    assert.match(d.querySelector('.times').textContent, /fortsætter det over midnat/);
    const before = w.__receiveSaves ?? 0;
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves ?? 0, before);
    assert.match(d.querySelector('.times [role=alert]').textContent, /Start og slut er ens for tirsdag/);
    await click(d.querySelector('.wrow button.rm'));
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves, before + 1, 'overnight window alone saves');
  } finally { await fixture.close(); }
});
test('timezone text says what really happens; Gem saves the zone right away', { timeout: 10000 }, async () => {
  const fixture = await openTimes({ enabled: false, mode: 'fixed' });
  const { d, w } = fixture;
  try {
    const text = d.querySelector('.timezone-summary').textContent;
    assert.match(text, /Fast tidszone\. Tryk Skift for at følge telefonen\./);
    assert.ok(!/Opdateres, når du åbner/.test(d.querySelector('.times').textContent));
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveLastSave.timezone, 'Europe/Copenhagen');
  } finally { await fixture.close(); }
});
