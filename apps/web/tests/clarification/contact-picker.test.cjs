// Invite email field: "Vælg fra kontakter" is hidden unless a picker is available,
// fills the field without storing anything, and lets the user choose when a
// contact has several emails. Synthetic mocks only — no real contacts.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, label, click } = require('./support.cjs');
const put = async (w, el, v) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20); };

const btn = (d, text) => [...d.querySelectorAll('button')].find(b => b.textContent.trim() === text);
async function openFrontInvite(d) {
  const open = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Invitér til Rolff');
  assert.ok(open, 'front Invitér til Rolff');
  await click(open); await delay(60);
}
async function openChatInvite(d, w) {
  w.QA.allowMemberInvite(true);
  await click(d.querySelector('.convbtn')); await delay(80);
  await click(label(d, 'Invitér person til denne samtale')); await delay(60);
}

test('without a picker the contacts button is hidden on both invite cards', async () => {
  const f = await env(); const { d, w } = f; try {
    await openFrontInvite(d);
    assert.equal(btn(d, 'Vælg fra kontakter'), undefined);
    d.querySelector('.sheet [aria-label="Luk"]').click(); await delay(40);
    await openChatInvite(d, w);
    assert.equal(btn(d, 'Vælg fra kontakter'), undefined);
    assert.ok(d.getElementById('me'), 'in-conversation email field still there');
  } finally { await f.close(); }
});

test('Invitér til Rolff: picking one email fills the field and is not stored or sent yet', async () => {
  const f = await env(); const { d, w } = f; try {
    const picked = [];
    w.QA.setContactEmailPicker({
      supported: () => true,
      pickEmails: async () => { picked.push('anna@example.invalid'); return ['anna@example.invalid']; },
    });
    await openFrontInvite(d);
    const b = btn(d, 'Vælg fra kontakter'); assert.ok(b, 'button shown when supported');
    await click(b); await delay(20);
    assert.equal(d.getElementById('ie').value, 'anna@example.invalid');
    assert.equal(picked.length, 1);
    assert.equal(w.QA.calls.filter(c => c.function === 'invite-email').length, 0, 'only fills the field');
    assert.ok(!d.body.textContent.includes('Kontakten har flere e-mails'));
  } finally { await f.close(); }
});

test('Invitér person til denne samtale: several emails, user chooses one', async () => {
  const f = await env(); const { d, w } = f; try {
    w.QA.setContactEmailPicker({
      supported: () => true,
      pickEmails: async () => ['arbejde@example.invalid', 'privat@example.invalid'],
    });
    await openChatInvite(d, w);
    assert.ok(btn(d, 'Vælg fra kontakter'));
    await click(btn(d, 'Vælg fra kontakter')); await delay(20);
    assert.equal(d.getElementById('me').value, '', 'field empty until a choice');
    assert.match(d.querySelector('.contact-emails').textContent, /Kontakten har flere e-mails/);
    const work = btn(d, 'arbejde@example.invalid'); assert.ok(work);
    await click(work); await delay(20);
    assert.equal(d.getElementById('me').value, 'arbejde@example.invalid');
    assert.equal(d.querySelector('.contact-emails'), null, 'chooser closes');
    assert.equal(w.QA.calls.filter(c => c.function === 'invite-email').length, 0);
  } finally { await f.close(); }
});

test('cancelling the picker leaves the field unchanged', async () => {
  const f = await env(); const { d, w } = f; try {
    w.QA.setContactEmailPicker({ supported: () => true, pickEmails: async () => [] });
    await openFrontInvite(d);
    await put(w, d.getElementById('ie'), 'allerede@example.invalid');
    await click(btn(d, 'Vælg fra kontakter')); await delay(20);
    assert.equal(d.getElementById('ie').value, 'allerede@example.invalid');
    assert.equal(d.querySelector('.err'), null);
  } finally { await f.close(); }
});

test('a picker failure is explained and the field is left alone', async () => {
  const f = await env(); const { d, w } = f; try {
    w.QA.setContactEmailPicker({ supported: () => true, pickEmails: async () => { throw Error('boom'); } });
    await openFrontInvite(d);
    await put(w, d.getElementById('ie'), 'allerede@example.invalid');
    await click(btn(d, 'Vælg fra kontakter')); await delay(20);
    assert.match(d.querySelector('.err').textContent, /Kontakten kunne ikke åbnes/);
    assert.equal(d.getElementById('ie').value, 'allerede@example.invalid');
  } finally { await f.close(); }
});


test('uniqueEmails and the Web Contact Picker API fill the field from a Mor-like result', async () => {
  const f = await env(); const { d, w } = f; try {
    const ue = w.QA.uniqueEmails;
    assert.equal(JSON.stringify(ue([{ email: ['mor@example.invalid', 'mor@example.invalid'] }])), JSON.stringify(['mor@example.invalid']));
    assert.equal(JSON.stringify(ue([{ name: ['Mor'], email: [{ address: 'mor@example.invalid' }, { address: 'mor@example.invalid' }] }])), JSON.stringify(['mor@example.invalid']));
    assert.equal(JSON.stringify(ue([{ email: 'mailto:mor@example.invalid' }])), JSON.stringify(['mor@example.invalid']));
    assert.equal(JSON.stringify(ue([{ email: 'Mor <mor@example.invalid>' }])), JSON.stringify(['mor@example.invalid']));
    assert.equal(JSON.stringify(ue({ email: 'one@example.invalid' })), JSON.stringify(['one@example.invalid']));

    w.QA.setContactEmailPicker(null);
    w.QA.clearInviteEmailDrafts();
    Object.defineProperty(w.navigator, 'contacts', {
      configurable: true,
      value: {
        select: async (props, opts) => {
          w.__pickedProps = { props: [...props], multiple: !!(opts && opts.multiple) };
          return [{ name: ['Mor'], email: [{ address: 'mor@example.invalid' }, { address: 'mor@example.invalid' }] }];
        },
      },
    });
    await openFrontInvite(d);
    const b = btn(d, 'Vælg fra kontakter'); assert.ok(b, 'button shown when navigator.contacts.select exists');
    await click(b); await delay(40);
    assert.equal(d.getElementById('ie').value, 'mor@example.invalid');
    assert.deepEqual(w.__pickedProps.props, ['name', 'email']);
    assert.equal(w.__pickedProps.multiple, false);
    assert.equal(w.QA.calls.filter(c => c.function === 'invite-email').length, 0);
  } finally { await f.close(); }
});
