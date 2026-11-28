// Abonnement sheet: quiet "Din plan" label, aligned action area, toast confirmation, short rule lines. Synthetic data only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
async function openPlans(f) {
  const { d } = f; await click(label(d, 'Menu'));
  const item = [...d.querySelectorAll('button,[role=menuitem]')].find(b => b.textContent.trim() === 'Abonnement'); assert.ok(item, 'Abonnement menu item');
  await click(item); await delay(60); const sheet = d.querySelector('.plans'); assert.ok(sheet, 'plans rendered'); return sheet;
}

function downgradeCard(d) {
  return d.querySelector('.confirm-card');
}
async function expectDowngradeCard(d, { immediate = false } = {}) {
  const card = downgradeCard(d);
  assert.ok(card, 'downgrade confirm card');
  assert.equal(card.querySelector('#confirm-title')?.textContent, 'Nedgradér til Standard?');
  const text = card.textContent;
  if (immediate) assert.match(text, /Ændringen gælder med det samme/);
  else assert.match(text, /Fra 9\. december 2026 gælder Standard/);
  assert.match(text, /Sky-synk slås fra/);
  assert.match(text, /Beskeder, der allerede ligger på serveren, bliver/);
  assert.match(text, /160 tegn pr\. besked/);
  assert.match(text, /ikke længere sende screenshots, billeder eller PDF/);
  assert.match(text, /stadig se vedhæftninger, du modtager/);
  assert.match(text, /ikke tilføje ekstra personer/);
  assert.match(text, /allerede er med, bliver/);
  assert.ok(!/synk-kopi|sync.copy|nøglen på serveren|key on the server|slettes/.test(text), 'do not claim a sync copy/key is deleted');
  assert.ok(card.querySelector('[aria-label="Luk"]'), 'X-only close');
  assert.ok(![...card.querySelectorAll('button')].some(b => /Annuller/.test(b.textContent)));
  const keep = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Behold Premium');
  const ok = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Nedgradér');
  assert.ok(keep && ok);
  assert.ok(ok.closest('.confirm-actions.end'), 'primary on the right');
  const actions = card.querySelector('.confirm-actions.end');
  assert.ok(actions.lastElementChild === ok);
  return { card, keep, ok };
}
test('current plan has a quiet label (not a button); other plan keeps its action in the bottom area', async () => {
  const f = await env(); const { d } = f; try {
    const plans = await openPlans(f);
    const cur = plans.querySelector('.plan.current'); const other = plans.querySelector('.plan:not(.current)');
    const badge = cur.querySelector('.plan-badge:not(.plan-badge-spacer)');
    assert.equal(badge.tagName, 'SPAN'); assert.equal(badge.textContent, 'Din plan');
    assert.equal(cur.querySelector('button'), null, 'current card has no button');
    assert.ok(cur.firstElementChild === badge, 'badge is at the top of the card');
    assert.equal(cur.getAttribute('aria-current'), 'true');
    const spacer = other.querySelector('.plan-badge-spacer'); assert.equal(spacer.getAttribute('aria-hidden'), 'true');
    const btn = other.querySelector('.plan-foot > button'); assert.ok(btn); assert.equal(btn.textContent, 'Nedgradér til Standard');
    assert.ok(!/Din nuværende plan/.test(d.body.textContent));
    const titles = [...plans.querySelectorAll('h3')].map(h => h.textContent);
    assert.deepEqual(titles, ['Standard', 'Premium']);
    assert.match(cur.textContent, /79 kr\./);
    assert.match(other.textContent, /49 kr\./);
    assert.ok(!/Tekst \+ vedhæftninger/.test(d.body.textContent));
    assert.equal(cur.querySelector('h3').textContent, 'Premium');
    assert.equal(other.querySelector('h3').textContent, 'Standard');
  } finally { await f.close(); }
});
test('rule text is two short lines without "Regel:"; TESTFUNKTION kept, no period line', async () => {
  const f = await env(); const { d } = f; try {
    await openPlans(f);
    const rules = [...d.querySelectorAll('.plan-rule')].map(p => p.textContent);
    assert.deepEqual(rules, ['Opgradering gælder med det samme. Nedgradering gælder fra næste periode.', 'Planen gælder kun dig – den anden forælder kan have en anden plan, og alle kan altid se vedhæftninger, de modtager.']);
    assert.ok(!/Regel:/.test(d.body.textContent));
    assert.ok(!/Periode slutter/.test(d.body.textContent), 'no period line without a pending downgrade'); assert.match(d.body.textContent, /TESTFUNKTION – ingen betaling\./);
  } finally { await f.close(); }
});
test('plan change confirms with the app-wide success toast, not an orange notice', async () => {
  const f = await env(); const { w, d } = f; try {
    const plans = await openPlans(f);
    await click(plans.querySelector('.plan:not(.current) .plan-foot > button')); await delay(80);
    assert.equal(w.QA.calls.filter(c => c.name === 'set_my_plan_test').length, 0, 'no plan change until confirmed');
    const { ok } = await expectDowngradeCard(d);
    await click(ok); await delay(80);
    const calls = w.QA.calls.filter(c => c.name === 'set_my_plan_test'); assert.equal(calls.length, 1); assert.equal(JSON.stringify(calls[0].args), JSON.stringify({ p_plan: 'text', p_now: false }));
    const region = d.querySelector('.toast-region'); assert.ok(region); assert.equal(region.getAttribute('aria-live'), 'polite'); assert.equal(region.getAttribute('role'), 'status');
    const pill = region.querySelector('.toast-pill'); assert.equal(pill.textContent, 'Planen er skiftet.'); assert.ok(pill.classList.contains('is-success'));
    assert.ok(![...d.querySelectorAll('.notice')].some(n => /Planen er skiftet/.test(n.textContent)), 'no orange box');
    assert.equal(d.querySelectorAll('.toast-region').length, 1, 'single app-wide toast region');
    assert.equal(d.querySelector('.plan.current .plan-badge:not(.plan-badge-spacer)').closest('.plan').querySelector('h3').textContent, 'Standard');
    assert.equal(d.querySelector('.plan:not(.current) .plan-foot > button').textContent, 'Opgradér til Premium');
  } finally { await f.close(); }
});
test('period end is shown only while a downgrade is pending (da)', async () => {
  const f = await env(); const { w, d } = f; try {
    w.QA.setPendingPlan('text');
    await openPlans(f);
    assert.match(d.body.textContent, /Periode slutter: 9\. december 2026/);
    assert.match(d.body.textContent, /Skifter hertil ved næste periode\./);
  } finally { await f.close(); }
});

test('Opsig abonnement on the Abonnement sheet keeps the account and shows the end date', async () => {
  const f = await env(); const { d, w } = f; try {
    const plans = await openPlans(f);
    const sheet = d.querySelector('.sheet'); const cancel = [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === 'Opsig abonnement');
    assert.ok(cancel, 'cancel on plans sheet');
    assert.ok(cancel.classList.contains('plan-cancel'), 'discreet link, not a primary button');
    const rules = [...sheet.querySelectorAll('.plan-rule')];
    assert.ok(rules.length >= 2, 'footnotes present');
    const lastRule = rules[rules.length - 1];
    assert.ok(cancel.compareDocumentPosition(lastRule) & 2, 'cancel link is after the footnotes');
    const css = require('fs').readFileSync(require('path').join(__dirname, '../../src/styles.css'), 'utf8');
    assert.match(css, /button\.plan-cancel,\.plan-cancel\{[^}]*min-height:44px/);
    await click(cancel); await delay(60);
    const card = d.querySelector('.confirm-card'); assert.ok(card);
    assert.match(card.textContent, /Konto og data bliver/);
    assert.match(card.textContent, /9\. december 2026/);
    const alt = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skift til Standard i stedet');
    assert.ok(alt, 'Premium cancel offers Switch to Standard');
    assert.ok(![...card.querySelectorAll('button')].some(b => /Annuller/.test(b.textContent)));
    assert.ok(card.querySelector('[aria-label="Luk"]'), 'X-only close');
    const ok = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Opsig abonnement');
    await click(ok); await delay(80);
    assert.ok(w.QA.calls.some(c => c.name === 'cancel_my_subscription'));
    assert.match(d.body.textContent, /Dit abonnement udløber 9\. december 2026/);
    assert.ok(!/Periode slutter/.test(d.body.textContent), 'free pending uses the cancel wording, not the plan-switch line');
    const resume = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Genoptag abonnement');
    assert.ok(resume); await click(resume); await delay(80);
    assert.ok(w.QA.calls.some(c => c.name === 'resume_my_subscription'));
    assert.match(d.body.textContent, /Abonnementet er genoptaget/);
    assert.ok([...d.querySelectorAll('button')].some(b => b.textContent.trim() === 'Opsig abonnement'));
  } finally { await f.close(); }
});

test('Abonnement sheet has only the sheet heading, not a second Abonnement title', async () => {
  const f = await env(); const { d } = f; try {
    await openPlans(f);
    const sheet = d.querySelector('.sheet');
    const titles = [...sheet.querySelectorAll('h1,h2')].map(h => h.textContent.trim()).filter(t => t === 'Abonnement');
    assert.equal(titles.length, 1, 'single Abonnement heading');
    assert.equal(sheet.querySelector('.sub-manage h2'), null);
  } finally { await f.close(); }
});

test('Skift til Standard i stedet schedules Standard and does not cancel', async () => {
  const f = await env(); const { d, w } = f; try {
    await openPlans(f);
    const sheet = d.querySelector('.sheet');
    const cancel = [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === 'Opsig abonnement');
    await click(cancel); await delay(60);
    const card = d.querySelector('.confirm-card');
    const alt = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skift til Standard i stedet');
    await click(alt); await delay(80);
    assert.ok(!w.QA.calls.some(c => c.name === 'set_my_plan_test'), 'downgrade confirm comes first');
    const { ok } = await expectDowngradeCard(d);
    await click(ok); await delay(80);
    assert.ok(w.QA.calls.some(c => c.name === 'set_my_plan_test' && c.args && c.args.p_plan === 'text'));
    assert.ok(!w.QA.calls.some(c => c.name === 'cancel_my_subscription'));
    assert.equal(d.querySelector('.confirm-card'), null);
    assert.equal(d.querySelector('.plan.current h3').textContent, 'Standard');
  } finally { await f.close(); }
});

test('Behold Premium and the X close the downgrade card without changing the plan', async () => {
  const f = await env(); const { d, w } = f; try {
    const plans = await openPlans(f);
    await click(plans.querySelector('.plan:not(.current) .plan-foot > button')); await delay(80);
    const first = await expectDowngradeCard(d);
    await click(first.keep); await delay(60);
    assert.equal(d.querySelector('.confirm-card'), null);
    assert.equal(w.QA.calls.filter(c => c.name === 'set_my_plan_test').length, 0);
    assert.equal(d.querySelector('.plan.current h3').textContent, 'Premium');
    await click(plans.querySelector('.plan:not(.current) .plan-foot > button')); await delay(80);
    const again = await expectDowngradeCard(d);
    await click(again.card.querySelector('[aria-label="Luk"]')); await delay(60);
    assert.equal(d.querySelector('.confirm-card'), null);
    assert.equal(w.QA.calls.filter(c => c.name === 'set_my_plan_test').length, 0);
  } finally { await f.close(); }
});

test('Skift straks (kun test) on a pending downgrade also asks before applying immediately', async () => {
  const f = await env(); const { d, w } = f; try {
    w.QA.setPendingPlan('text');
    await openPlans(f);
    const now = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skift straks (kun test)');
    assert.ok(now, 'immediate test switch');
    await click(now); await delay(80);
    assert.equal(w.QA.calls.filter(c => c.name === 'set_my_plan_test').length, 0);
    const { ok } = await expectDowngradeCard(d, { immediate: true });
    await click(ok); await delay(80);
    const calls = w.QA.calls.filter(c => c.name === 'set_my_plan_test');
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls[0].args), JSON.stringify({ p_plan: 'text', p_now: true }));
  } finally { await f.close(); }
});

