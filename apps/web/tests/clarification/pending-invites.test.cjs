// Compact pending-invitation bar + Enter-to-submit invite forms. Synthetic fixtures only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, label, click, button } = require('./support.cjs');
const openChat = async (d) => { await click(d.querySelector('.convbtn')); await delay(80); };
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20); };
const enter = async (w, input) => { input.form.requestSubmit(); await delay(60); };
const toastText = (d) => d.querySelector('.toast-region')?.textContent ?? '';

test('one pending invite: single collapsed line with email; expands to row with progress and Træk tilbage', async () => {
  const f = await env(); const { d } = f; try {
    await openChat(d);
    const bar = d.querySelector('.pendbar'); assert.ok(bar);
    assert.equal(d.querySelectorAll('.pendbar').length, 1);
    const head = bar.querySelector('.pendbar-head');
    assert.equal(head.textContent, 'Afventer godkendelse: advokat.test@example.invalid');
    assert.equal(head.getAttribute('aria-expanded'), 'false'); assert.ok(!bar.classList.contains('is-open'));
    const body = d.getElementById(head.getAttribute('aria-controls')); assert.ok(body.hasAttribute('inert'), 'collapsed list not focusable');
    await click(head);
    assert.equal(head.getAttribute('aria-expanded'), 'true'); assert.ok(!body.hasAttribute('inert'));
    const row = bar.querySelector('.pendrow');
    assert.match(row.textContent, /advokat\.test@example\.invalid/); assert.match(row.textContent, /kun læse · 1 af 2 har godkendt/); assert.match(row.textContent, /1 af 2 har godkendt/);
    assert.ok([...row.querySelectorAll('button')].some(b => b.textContent === 'Træk tilbage'));
    await click(head); assert.equal(head.getAttribute('aria-expanded'), 'false');
  } finally { await f.close(); }
});

test('several invites: "3 afventer godkendelse"; approver rows keep Godkend/Afvis reachable', async () => {
  const f = await env(); const { w, d } = f; try {
    w.QA.setPendingInvites([
      { id: 'a', role: 'reader', invitee_email: 'a@example.invalid', consents: 1, required: 2, i_consented: true, mine: true },
      { id: 'b', role: 'writer', invitee_email: 'b@example.invalid', consents: 1, required: 2, i_consented: false, mine: false },
      { id: 'c', role: 'reader', invitee_email: 'c@example.invalid', consents: 2, required: 2, i_consented: true, mine: false }]);
    await openChat(d);
    const head = d.querySelector('.pendbar-head');
    assert.equal(head.textContent, '3 afventer godkendelse · 1 venter på dig');
    assert.ok(d.querySelector('.pendbar').classList.contains('needs-me'));
    await click(head);
    const rows = [...d.querySelectorAll('.pendrow')]; assert.equal(rows.length, 3);
    assert.deepEqual([...rows[1].querySelectorAll('button')].map(b => b.textContent), ['Afvis', 'Godkend']);
    assert.match(rows[2].textContent, /Alle har godkendt/);
    const before = w.QA.calls.filter(c => c.function === 'invite-email').length;
    await click([...rows[1].querySelectorAll('button')].find(b => b.textContent === 'Godkend')); await delay(40);
    const call = w.QA.calls.filter(c => c.function === 'invite-email').at(-1);
    assert.equal(w.QA.calls.filter(c => c.function === 'invite-email').length, before + 1);
    assert.equal(call.args.action, 'consent'); assert.equal(call.args.invitation_id, 'b');
  } finally { await f.close(); }
});

test('no pending invites: no bar', async () => {
  const f = await env(); const { w, d } = f; try {
    w.QA.setPendingInvites([]); await openChat(d);
    assert.equal(d.querySelector('.pendbar'), null);
  } finally { await f.close(); }
});

test('Tilføj person: Enter with invalid email shows inline error and keeps the text; valid Enter closes sheet, toast, new bar row', async () => {
  const f = await env(); const { w, d } = f; try {
    w.QA.allowMemberInvite(true); await openChat(d);
    await click(label(d, 'Tilføj person'));
    const input = d.getElementById('me'); assert.ok(input);
    assert.equal(input.getAttribute('inputmode'), 'email'); assert.equal(input.getAttribute('enterkeyhint'), 'send'); assert.equal(input.getAttribute('autocomplete'), 'off');
    input.focus(); await put(w, input, 'ikke-en-mail');
    const n = w.QA.calls.filter(c => c.function === 'invite-email').length;
    await enter(w, input);
    assert.equal(input.value, 'ikke-en-mail', 'field not cleared');
    const err = d.getElementById('me-err'); assert.ok(err); assert.match(err.textContent, /gyldig e-mailadresse/);
    assert.equal(input.getAttribute('aria-invalid'), 'true'); assert.equal(input.getAttribute('aria-describedby'), 'me-err');
    assert.ok(input.compareDocumentPosition(err) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'error right after the field');
    assert.ok(err.previousElementSibling === input, 'error directly below the field');
    assert.equal(w.QA.calls.filter(c => c.function === 'invite-email').length, n, 'invalid email is not sent');
    await put(w, input, '  ny.person@example.invalid ');
    assert.equal(d.getElementById('me-err'), null, 'typing clears the error');
    await enter(w, input); await delay(60);
    const call = w.QA.calls.filter(c => c.function === 'invite-email').at(-1);
    assert.equal(call.args.action, 'member'); assert.equal(call.args.email, 'ny.person@example.invalid');
    assert.equal(d.getElementById('me'), null, 'sheet closed on success');
    assert.ok(d.activeElement !== input);
    assert.match(toastText(d), /Anmodning sendt for ny\.person@example\.invalid – afventer godkendelse\./);
    assert.ok(d.querySelector('.toast-region').style.top, 'toast placed at the top');
    assert.equal(d.querySelector('.pendbar-head').textContent, '2 afventer godkendelse');
  } finally { await f.close(); }
});

test('Inviter person (front page): Enter validates inline; success closes the sheet and shows a toast', async () => {
  const f = await env(); const { w, d } = f; try {
    const open = [...d.querySelectorAll('button')].find(b => /Inviter person/.test(b.textContent)); assert.ok(open); await click(open);
    const input = d.getElementById('ie'); assert.ok(input); assert.equal(input.getAttribute('enterkeyhint'), 'send');
    await put(w, input, 'x@'); await enter(w, input);
    assert.equal(input.value, 'x@'); assert.match(d.getElementById('ie-err').textContent, /gyldig e-mailadresse/);
    await put(w, input, 'ven@example.invalid'); await enter(w, input); await delay(60);
    assert.equal(d.getElementById('ie'), null, 'sheet closed');
    assert.match(toastText(d), /Invitation sendt til ven@example\.invalid/);
  } finally { await f.close(); }
});
