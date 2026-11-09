// Abonnement sheet: quiet "Din plan" label, aligned action area, toast confirmation, short rule lines. Synthetic data only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
async function openPlans(f) {
  const { d } = f; await click(label(d, 'Menu'));
  const item = [...d.querySelectorAll('button,[role=menuitem]')].find(b => b.textContent.trim() === 'Abonnement'); assert.ok(item, 'Abonnement menu item');
  await click(item); await delay(60); const sheet = d.querySelector('.plans'); assert.ok(sheet, 'plans rendered'); return sheet;
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
    const btn = other.querySelector('.plan-foot > button'); assert.ok(btn); assert.equal(btn.textContent, 'Nedgradér (test)');
    assert.ok(!/Din nuværende plan/.test(d.body.textContent));
  } finally { await f.close(); }
});
test('rule text is two short lines without "Regel:"; period line and TESTFUNKTION kept', async () => {
  const f = await env(); const { d } = f; try {
    await openPlans(f);
    const rules = [...d.querySelectorAll('.plan-rule')].map(p => p.textContent);
    assert.deepEqual(rules, ['Opgradering gælder med det samme. Nedgradering gælder fra næste periode.', 'Planen gælder kun dig – den anden forælder kan have en anden plan, og alle kan altid se vedhæftninger, de modtager.']);
    assert.ok(!/Regel:/.test(d.body.textContent));
    assert.match(d.body.textContent, /Periode slutter: /); assert.match(d.body.textContent, /TESTFUNKTION – ingen betaling\./);
  } finally { await f.close(); }
});
test('plan change confirms with the app-wide success toast, not an orange notice', async () => {
  const f = await env(); const { w, d } = f; try {
    const plans = await openPlans(f);
    await click(plans.querySelector('.plan:not(.current) .plan-foot > button')); await delay(80);
    const calls = w.QA.calls.filter(c => c.name === 'set_my_plan_test'); assert.equal(calls.length, 1); assert.equal(JSON.stringify(calls[0].args), JSON.stringify({ p_plan: 'text', p_now: false }));
    const region = d.querySelector('.toast-region'); assert.ok(region); assert.equal(region.getAttribute('aria-live'), 'polite'); assert.equal(region.getAttribute('role'), 'status');
    const pill = region.querySelector('.toast-pill'); assert.equal(pill.textContent, 'Planen er skiftet.'); assert.ok(pill.classList.contains('is-success'));
    assert.ok(![...d.querySelectorAll('.notice')].some(n => /Planen er skiftet/.test(n.textContent)), 'no orange box');
    assert.equal(d.querySelectorAll('.toast-region').length, 1, 'single app-wide toast region');
    assert.equal(d.querySelector('.plan.current .plan-badge:not(.plan-badge-spacer)').closest('.plan').querySelector('h3').textContent, 'Tekst');
  } finally { await f.close(); }
});
