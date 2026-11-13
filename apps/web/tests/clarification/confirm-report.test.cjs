// In-app ConfirmDialog (no window.confirm), conversation menu scope, and the Rapportér sheet. Synthetic only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, label, click, button } = require('./support.cjs');
const openChat = async (d) => { await click(d.querySelector('.convbtn')); await delay(80); };
const menu = async (d) => { await click(label(d, 'Menu')); return [...d.querySelectorAll('[role=menuitem]')]; };
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20); };

test('conversation ⋮ menu holds only conversation actions, Rapportér + Blokér last after a divider', async () => {
  const f = await env(); const { d } = f; try {
    await openChat(d);
    const items = await menu(d);
    assert.deepEqual(items.map(b => b.textContent), ['Deltagere og roller', 'Kontaktens kaldenavn', 'Eksportér samtale', 'Blokeringer', 'Rapportér', 'Blokér samtale']);
    const sep = d.querySelector('.menu [role=separator]'); assert.ok(sep && sep.nextElementSibling.textContent === 'Rapportér');
    assert.ok(items.at(-1).classList.contains('danger'));
  } finally { await f.close(); }
});

test('front-page ⋮ keeps every app-wide item', async () => {
  const f = await env(); const { d } = f; try {
    const labels = (await menu(d)).map(b => b.textContent);
    for (const l of ['Sprog', 'Tema', 'Modtagetider', 'FAQ', 'Abonnement', 'Konto (e-mail og adgangskode)', 'Privatliv og sletning', 'Privatlivspolitik', 'Feedback', 'Inviter person', 'Log ud']) assert.ok(labels.includes(l), l);
  } finally { await f.close(); }
});

test('Blokér samtale: in-app dialog (no window.confirm), Annuller keeps, Blokér blocks + toast, Esc cancels unblock', async () => {
  const f = await env(); const { w, d } = f; try {
    let nativeUsed = 0; w.confirm = () => { nativeUsed++; return true; }; w.alert = () => { nativeUsed++; }; w.prompt = () => { nativeUsed++; return null; };
    await openChat(d);
    await click((await menu(d)).find(b => b.textContent === 'Blokér samtale')); await delay(30);
    assert.equal(d.querySelector('.menu'), null, 'menu closed first');
    let dlg = d.querySelector('[role=alertdialog]'); assert.ok(dlg); assert.equal(dlg.getAttribute('aria-modal'), 'true');
    assert.equal(dlg.querySelector('h2').textContent, 'Blokér samtalen?');
    assert.match(dlg.textContent, /De andre kan ikke sende dig beskeder her, før du afblokerer\. De får ikke besked om det\./);
    assert.deepEqual([...dlg.querySelectorAll('button')].map(b => b.textContent), ['Annuller', 'Blokér']);
    assert.ok(d.activeElement === button(d, 'Annuller'), 'safe default focus');
    // focus trap
    dlg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); assert.ok(d.activeElement === button(d, 'Blokér'));
    dlg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); assert.ok(d.activeElement === button(d, 'Annuller'));
    await click(button(d, 'Annuller')); await delay(20);
    assert.equal(d.querySelector('[role=alertdialog]'), null);
    assert.equal(w.QA.calls.filter(c => c.name === 'block_conversation').length, 0);
    await click((await menu(d)).find(b => b.textContent === 'Blokér samtale')); await delay(30);
    await click(button(d, 'Blokér')); await delay(40);
    assert.equal(w.QA.calls.filter(c => c.name === 'block_conversation').length, 1);
    assert.match(d.querySelector('.toast-region').textContent, /Samtalen er blokeret/);
    await click((await menu(d)).find(b => b.textContent === 'Afblokér samtale')); await delay(30);
    dlg = d.querySelector('[role=alertdialog]'); assert.equal(dlg.querySelector('h2').textContent, 'Afblokér samtalen?');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await delay(30);
    assert.equal(d.querySelector('[role=alertdialog]'), null, 'Esc closes');
    assert.equal(w.QA.calls.filter(c => c.name === 'unblock_conversation').length, 0);
    assert.equal(nativeUsed, 0, 'no native confirm/alert/prompt');
  } finally { await f.close(); }
});

test('Træk tilbage asks in-app first; confirming withdraws', async () => {
  const f = await env(); const { w, d } = f; try {
    await openChat(d); await click(d.querySelector('.pendbar-head'));
    await click(button(d, 'Træk tilbage')); await delay(30);
    assert.equal(d.querySelector('[role=alertdialog] h2').textContent, 'Træk invitationen tilbage?');
    const n = w.QA.calls.filter(c => c.function === 'invite-email').length;
    await click(d.querySelector('[role=alertdialog] button.danger')); await delay(40);
    const c = w.QA.calls.filter(x => x.function === 'invite-email'); assert.equal(c.length, n + 1); assert.equal(c.at(-1).args.action, 'decline');
  } finally { await f.close(); }
});

test('Rapportér: fixed textarea + counter, contained list newest first with nickname + time, sticky preview button', async () => {
  const f = await env(); const { w, d } = f; try {
    await openChat(d);
    await click((await menu(d)).find(b => b.textContent === 'Rapportér')); await delay(30);
    const sheet = d.querySelector('.sheet'); assert.ok(sheet.classList.contains('anchored-card'), 'opens at the top like the other ⋮ sheets');
    assert.equal(sheet.querySelector('h2').textContent, 'Rapportér');
    const ta = d.getElementById('rb'); assert.ok(ta.classList.contains('fixed-text')); assert.equal(ta.maxLength, 2000);
    assert.equal(d.getElementById('rb-count').textContent, '0/2000');
    const btn = button(d, 'Se forhåndsvisning'); assert.equal(btn.getAttribute('aria-disabled'), 'true', 'not ready yet, but still tappable'); assert.ok(!btn.disabled); assert.ok(btn.closest('.sheet-actions'));
    await click(btn); assert.equal(d.querySelector('.sheet h2').textContent, 'Rapportér', 'stays on the form'); assert.equal(d.getElementById('report-hint').getAttribute('role'), 'alert', 'tap explains what is missing'); assert.equal(d.activeElement, d.getElementById('rb'), 'focus moves to the description'); assert.match(d.getElementById('rb').getAttribute('aria-describedby'), /report-hint/);
    assert.match(d.querySelector('.rm-head').textContent, /Valgt 0 af højst 20/);
    assert.match(d.querySelector('.rm-sub').textContent, /Nyeste øverst/);
    const row = d.querySelector('.report-msgs .report-msg'); assert.ok(row.querySelector('input.check'));
    assert.match(row.querySelector('.rm-meta').textContent, /^Dig · /); assert.ok(row.querySelector('time'));
    assert.ok(row.querySelector('.rm-body.clamp2'));
    await put(w, ta, 'Synthetic description\nline two'); assert.equal(d.getElementById('rb-count').textContent, '30/2000'); assert.ok(!btn.hasAttribute('aria-disabled'));
    await click(btn); await delay(30);
    assert.equal(d.querySelector('.sheet h2').textContent, 'Rapportér · Tjek og send');
    const dts = [...d.querySelectorAll('.report-summary dt')].map(x => x.textContent); assert.deepEqual(dts, ['Kategori', 'Beskrivelse', 'Vedhæftede beskeder (0)']);
    assert.equal(d.querySelector('.report-summary .chip').textContent, 'Chikane/trusler');
    assert.equal(d.querySelector('.rs-body').textContent, 'Synthetic description\nline two');
    assert.match(d.querySelector('.rs-foot').textContent, /bruger-id og samtale-id/);
    assert.deepEqual([...d.querySelectorAll('.sheet-actions.two button')].map(b => b.textContent), ['Ret', 'Bekræft og send rapport']);
    { const b = button(d, 'Bekræft og send rapport'); b.click(); b.click(); } await delay(80);
    assert.equal(w.QA.calls.filter(c => c.function === 'report').length, 1, 'no double submit');
    assert.equal(d.querySelector('.sheet'), null, 'sheet closed on success');
    assert.match(d.querySelector('.toast-region').textContent, /Rapporten er sendt/);
  } finally { await f.close(); }
});
