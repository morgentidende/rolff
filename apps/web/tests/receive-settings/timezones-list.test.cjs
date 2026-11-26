const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

let api;
async function tz() {
  if (api) return api;
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../../src/timezones.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  api = module.exports;
  return api;
}

const winter = new Date('2026-11-26T12:00:00Z');
const summer = new Date('2026-07-01T12:00:00Z');

test('UTC is first in the full unfiltered list', async () => {
  const { searchTimezones } = await tz();
  const list = searchTimezones('', 'Europe/Copenhagen', 'da', winter);
  assert.equal(list[0], 'UTC');
  assert.ok(list.length > 300, 'expected a long IANA list, got ' + list.length);
  assert.ok(list.includes('Europe/Copenhagen'));
  assert.ok(list.includes('America/New_York'));
  assert.ok(list.some(z => z === 'Asia/Kolkata' || z === 'Asia/Calcutta'));
  assert.ok(!list.includes('Etc/UTC'));
  assert.ok(!list.some(z => z.startsWith('Etc/')));
  assert.equal(new Set(list).size, list.length);
});

test('remaining zones are sorted by current UTC offset, then name', async () => {
  const { searchTimezones, timezoneOffsetMinutes } = await tz();
  const rest = searchTimezones('', '', 'en', winter).slice(1);
  for (let i = 1; i < rest.length; i++) {
    const prev = timezoneOffsetMinutes(rest[i - 1], winter) ?? 0;
    const next = timezoneOffsetMinutes(rest[i], winter) ?? 0;
    assert.ok(prev <= next, `${rest[i - 1]} (${prev}) should not sort after ${rest[i]} (${next})`);
  }
});

test('labels use a DST-aware UTC offset and keep readable city names', async () => {
  const { formatUtcOffset, timezoneLabel, timezoneOffsetMinutes } = await tz();
  assert.equal(timezoneLabel('UTC', 'da', winter), 'UTC');
  assert.equal(timezoneLabel('Etc/UTC', 'en', winter), 'UTC');
  assert.equal(timezoneOffsetMinutes('Europe/Copenhagen', winter), 60);
  assert.equal(timezoneOffsetMinutes('Europe/Copenhagen', summer), 120);
  assert.equal(timezoneLabel('Europe/Copenhagen', 'da', winter), 'UTC+1 · København – dansk tid');
  assert.equal(timezoneLabel('Europe/Copenhagen', 'da', summer), 'UTC+2 · København – dansk tid');
  assert.ok(timezoneLabel('Europe/Copenhagen', 'en', winter).startsWith('UTC+1 · Copenhagen'));
  assert.equal(formatUtcOffset(330), 'UTC+5:30');
  assert.ok(timezoneLabel('Asia/Kolkata', 'en', winter).startsWith('UTC+5:30 · '));
  assert.equal(timezoneOffsetMinutes('America/New_York', winter), -300);
  assert.equal(timezoneOffsetMinutes('America/New_York', summer), -240);
  assert.ok(timezoneLabel('America/New_York', 'en', winter).startsWith('UTC-5 · '));
  assert.ok(timezoneLabel('Africa/Abidjan', 'en', winter).startsWith('UTC+0 · '));
  assert.equal(formatUtcOffset(825), 'UTC+13:45');
});

test('search filters the long list and only pins UTC when it matches', async () => {
  const { searchTimezones } = await tz();
  const cph = searchTimezones('københavn', 'UTC', 'da', winter);
  assert.ok(cph.includes('Europe/Copenhagen'));
  assert.ok(!cph.includes('UTC'));
  const utc = searchTimezones('utc', 'Europe/Copenhagen', 'en', winter);
  assert.equal(utc[0], 'UTC');
  const plus1 = searchTimezones('utc+1', '', 'da', winter);
  assert.ok(plus1.includes('Europe/Copenhagen'));
  assert.ok(!plus1.includes('UTC'));
  assert.deepEqual(searchTimezones('xyzzy-not-a-zone', '', 'en', winter), []);
});

test('a stored current zone stays in the list even if it is unusual', async () => {
  const { searchTimezones } = await tz();
  const list = searchTimezones('', 'America/Godthab', 'da', winter);
  assert.ok(list.includes('America/Godthab'));
  assert.equal(list[0], 'UTC');
});
