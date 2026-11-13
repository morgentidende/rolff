const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click, openConversation, openTimes } = require('./support.cjs');

test('front-page menu no longer has Modtagetider; conversation menu does', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d } = fixture;
  try {
    await click(label(d, 'Menu'));
    const home = [...d.querySelectorAll('[role=menuitem]')].map(b => b.textContent.trim());
    assert.ok(!home.includes('Modtagetider'), home.join(', '));
    await click(label(d, 'Menu'));
    await openConversation(d);
    await click(label(d, 'Menu'));
    const conv = [...d.querySelectorAll('[role=menuitem], [role=menuitemcheckbox]')].map(b => b.textContent.trim());
    assert.ok(conv.includes('Modtagetider'), conv.join(', '));
  } finally {
    await fixture.close();
  }
});

test('enabling modtagetider prefills Mon-Sun 18-19 as seven fixed day rows', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    await openTimes(d, w);
    assert.ok(d.querySelector('.times'), 'sheet shows receive settings');
    assert.equal(d.querySelectorAll('.dayrow').length, 0, 'day rows hidden while off');
    const toggle = d.querySelector('.receive-fields > .switch input[type=checkbox]');
    assert.ok(toggle);
    await click(toggle);
    assert.equal(toggle.checked, true, 'toggle on');
    assert.equal(d.querySelectorAll('.dayrow').length, 7, 'one row per weekday');
    const labels = [...d.querySelectorAll('.day-label')].map(n => n.textContent.trim());
    assert.deepEqual(labels, ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']);
    const on = [...d.querySelectorAll('.dayrow .toggle-switch')].every(b => b.getAttribute('aria-checked') === 'true');
    assert.ok(on, 'all days on');
    const times = [...d.querySelectorAll('.dayrow')].map(row => [...row.querySelectorAll('select')].map(s => s.value));
    assert.ok(times.every(t => t[0] === String(18 * 60) && t[1] === String(19 * 60)), 'each day is 18:00–19:00');
    assert.equal(button(d, 'Gem').disabled, false, 'Gem enabled with default windows');
    assert.ok(button(d, 'Annuller'), 'Cancel is visible');
  } finally {
    await fixture.close();
  }
});

test('Gem explains when enabled with every day off; nothing is saved', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    await openTimes(d, w);
    await click(d.querySelector('.receive-fields > .switch input[type=checkbox]'));
    assert.equal(d.querySelectorAll('.dayrow').length, 7);
    for (const sw of [...d.querySelectorAll('.dayrow .toggle-switch')]) await click(sw);
    assert.ok([...d.querySelectorAll('.day-closed')].every(n => /Ingen beskeder/.test(n.textContent || '')), 'off days say Ingen beskeder');
    const hint = [...d.querySelectorAll('.times .meta, .times [role=status]')].map(n => n.textContent || '').join(' ');
    assert.match(hint, /Tilføj mindst ét tidsrum|Add at least one time window/i);
    const gem = button(d, 'Gem'); assert.equal(gem.disabled, false, 'still tappable'); assert.equal(gem.getAttribute('aria-disabled'), 'true');
    const before = w.__receiveSaves ?? 0; await click(gem); assert.equal(w.__receiveSaves ?? 0, before, 'nothing saved');
    assert.ok([...d.querySelectorAll('.times [role=alert]')].some(n => /Tilføj mindst ét tidsrum/.test(n.textContent)), 'tap shows why');
  } finally {
    await fixture.close();
  }
});

test('overlapping ranges on the same day are merged automatically on Gem', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    await openTimes(d, w, { enabled: true, windows: [{ weekday: 1, start_minute: 1080, end_minute: 1140 }, { weekday: 1, start_minute: 1020, end_minute: 1200 }, { weekday: 3, start_minute: 1080, end_minute: 1140 }] });
    const mon = d.querySelectorAll('.dayrow')[0];
    assert.equal(mon.querySelectorAll('.wrow').length, 2, 'Monday shows two ranges');
    const before = w.__receiveSaves ?? 0;
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves, before + 1, 'saved after auto-merge');
    assert.deepEqual(JSON.parse(JSON.stringify(w.__receiveLastSave.windows)), [{ weekday: 1, start_minute: 1020, end_minute: 1200 }, { weekday: 3, start_minute: 1080, end_minute: 1140 }]);
    assert.equal(d.querySelectorAll('.dayrow')[0].querySelectorAll('.wrow').length, 1, 'Monday shows the merged range');
  } finally { await fixture.close(); }
});

test('start = end is explained on Gem; overnight windows are allowed and explained', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    await openTimes(d, w, { enabled: true, windows: [{ weekday: 2, start_minute: 1200, end_minute: 1200 }, { weekday: 5, start_minute: 1320, end_minute: 120 }] });
    assert.match(d.querySelector('.times').textContent, /fortsætter det over midnat/);
    const before = w.__receiveSaves ?? 0;
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves ?? 0, before);
    assert.match(d.querySelector('.times [role=alert]').textContent, /Start og slut er ens for tirsdag/);
    await click(d.querySelectorAll('.dayrow')[1].querySelector('.toggle-switch'));
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves, before + 1, 'overnight window alone saves');
  } finally { await fixture.close(); }
});

test('timezone text says what really happens; Gem saves the zone right away', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    await openTimes(d, w, { enabled: false, mode: 'fixed' });
    const text = d.querySelector('.timezone-summary').textContent;
    assert.match(text, /Fast tidszone\. Tryk Skift for at følge telefonen\./);
    assert.ok(!/Opdateres, når du åbner/.test(d.querySelector('.times').textContent));
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveLastSave.timezone, 'Europe/Copenhagen');
    assert.equal(w.__receiveLastConv, '20000000-0000-4000-8000-000000000001');
  } finally { await fixture.close(); }
});

test('plus adds a second range on one day; copy sends that day to all days', { timeout: 10000 }, async () => {
  const fixture = await env(false);
  const { d, w } = fixture;
  try {
    await openTimes(d, w, { enabled: true, windows: [{ weekday: 1, start_minute: 1080, end_minute: 1140 }] });
    const mon = d.querySelectorAll('.dayrow')[0];
    assert.match(d.querySelectorAll('.dayrow')[1].textContent, /Ingen beskeder/);
    await click(mon.querySelector('.day-add'));
    assert.equal(mon.querySelectorAll('.wrow').length, 2);
    await click(mon.querySelector('.day-copy'));
    assert.equal(d.querySelectorAll('.day-closed').length, 0, 'copy turned other days on');
    const before = w.__receiveSaves ?? 0;
    await click(button(d, 'Gem'));
    assert.equal(w.__receiveSaves, before + 1);
    const byDay = new Map();
    for (const wdw of w.__receiveLastSave.windows) {
      byDay.set(wdw.weekday, (byDay.get(wdw.weekday) || 0) + 1);
    }
    assert.deepEqual([...byDay.keys()].sort(), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok([...byDay.values()].every(n => n === 2), 'every day has two ranges');
  } finally { await fixture.close(); }
});
