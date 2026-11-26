// Contact nickname BEFORE the invitation is accepted (private to the owner). Fully synthetic fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');

const pending = (mode = 'live') => (w) => { w.__QA_PENDING = mode; };
const rows = (d) => [...d.querySelectorAll('.convrow')];
const longPress = async (w, d) => { d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await delay(40); };
// Pending rows offer ONLY two choices (long press or tap); "Ændr kaldenavn" leads to the nickname sheet.
const openNickname = async (w, d) => { await longPress(w, d); await click(button(d, 'Ændr kaldenavn')); await delay(40); };
const type = async (w, d, v) => {
    const input = d.querySelector('#contact-alias-input'); assert.ok(input, 'nickname field');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, v);
    input.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20);
};
const rpcs = (w, name) => w.QA.calls.filter((c) => c.name === name);

test('pending row shows the e-mail and "venter på accept"; long press offers only two choices; the nickname sheet is short', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    assert.equal(d.querySelector('.convname').textContent, 'afventer@example.invalid');
    assert.match(d.querySelector('.convprev').textContent, /venter på accept/);
    await longPress(w, d);
    const menu = d.querySelector('dialog[open].pending-invite-menu'); assert.ok(menu, 'two-choice menu opens on a pending row');
    assert.deepEqual([...menu.querySelectorAll('button')].filter((b) => !b.classList.contains('icon')).map((b) => b.textContent), ['Ændr kaldenavn', 'Annullér invitation']);
    assert.ok(!d.querySelector('#contact-alias-input'), 'no nickname field yet');
    await click(button(d, 'Ændr kaldenavn')); await delay(40);
    const dlg = d.querySelector('dialog[open]'); assert.ok(dlg && !dlg.classList.contains('pending-invite-menu'), 'nickname sheet');
    assert.equal(dlg.querySelector('h2').textContent, 'Kontaktens kaldenavn');
    assert.ok(!dlg.querySelector('p.meta:not(#contact-alias-original)'), 'no explanatory paragraphs');
    assert.ok(!/ikke accepteret|aldrig se det|Kun du kan se|kan ændres, når/.test(dlg.textContent), 'explanations live in the FAQ');
    assert.ok(d.querySelector('#contact-alias-input'), 'field is editable');
    assert.ok(!d.querySelector('.alias-reset'), 'nothing to reset yet');
    assert.equal(d.querySelector('.alias-original').textContent, 'afventer@example.invalid');
    assert.ok(button(d, 'Gem'));
    assert.ok(d.querySelector('dialog[open] button[aria-label="Luk"]'));
    assert.ok(![...d.querySelectorAll('dialog[open] button')].some(b => /^(Annuller|Cancel)$/.test(b.textContent.trim())));
    await e.close();
});

test('tapping a pending row never opens the empty conversation: it opens the same two-choice menu', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await click(d.querySelector('.convbtn')); await delay(60);
    assert.ok(!d.querySelector('.topbar.chat'), 'no chat');
    assert.ok(d.querySelector('dialog[open].pending-invite-menu'), 'menu');
    await click(label(d, 'Luk')); await delay(30);
    assert.ok(!d.querySelector('dialog[open]'), 'menu closes');
    assert.ok(d.querySelector('.convrow'), 'still on the front page');
    await e.close();
});

test('Annullér invitation: asks first, then calls cancel_pending_invitation and removes the row', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await longPress(w, d); await click(button(d, 'Annullér invitation')); await delay(60);
    const dlg = d.querySelector('[role=alertdialog], [role=dialog]'); assert.ok(dlg, 'confirmation');
    assert.equal(rpcs(w, 'cancel_pending_invitation').length, 0, 'nothing happens before the confirmation');
    await click(dlg.querySelector('button[aria-label="Luk"]')); await delay(60);
    assert.equal(rpcs(w, 'cancel_pending_invitation').length, 0, 'declining the confirmation does nothing');
    assert.equal(d.querySelectorAll('.convrow').length, 1);
    await longPress(w, d); await click(button(d, 'Annullér invitation')); await delay(60);
    await click([...d.querySelectorAll('button')].filter((b) => b.textContent === 'Annullér invitation').at(-1)); await delay(120);
    const [c] = rpcs(w, 'cancel_pending_invitation'); assert.ok(c); assert.equal(JSON.stringify(c.args), JSON.stringify({ inv: w.QA.inv }));
    assert.equal(rpcs(w, 'decline_invitation').length + rpcs(w, 'revoke_invitation').length, 0);
    assert.equal(d.querySelectorAll('.convrow').length, 0, 'row is gone');
    await e.close();
});

test('Annullér invitation: a failure keeps the row and says so', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    w.__QA_CANCEL_ERROR = true;
    await longPress(w, d); await click(button(d, 'Annullér invitation')); await delay(60);
    await click([...d.querySelectorAll('button')].filter((b) => b.textContent === 'Annullér invitation').at(-1)); await delay(120);
    assert.equal(d.querySelectorAll('.convrow').length, 1, 'row stays');
    assert.match(d.body.textContent, /Det lykkedes ikke/);
    await e.close();
});

test('set, show in the list, edit and clear on a pending invitation (RPC set_invitation_alias, never set_contact_alias)', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await openNickname(w, d);
    await type(w, d, '  Far  ');
    await click(button(d, 'Gem')); await delay(60);
    const [c1] = rpcs(w, 'set_invitation_alias');
    assert.ok(c1); assert.equal(JSON.stringify(c1.args), JSON.stringify({ p_invitation: w.QA.inv, p_alias: '  Far  ' }));
    assert.equal(c1.headers.Authorization, 'Bearer ' + w.QA.TOKEN_A);
    assert.equal(rpcs(w, 'set_contact_alias').length, 0);
    assert.ok(!d.querySelector('dialog[open]'), 'sheet closes after saving');
    assert.equal(d.querySelector('.convname').textContent, 'Far', 'list shows the nickname');
    assert.match(d.querySelector('.convprev').textContent, /venter på accept/, 'still marked as waiting');
    // edit
    await openNickname(w, d);
    assert.equal(d.querySelector('#contact-alias-input').value, 'Far');
    await type(w, d, 'Far (arbejde)'); await click(button(d, 'Gem')); await delay(60);
    assert.equal(d.querySelector('.convname').textContent, 'Far (arbejde)');
    // clear via "Nulstil kaldenavn"
    await openNickname(w, d);
    await click(button(d, 'Nulstil kaldenavn')); await delay(60);
    assert.equal(rpcs(w, 'set_invitation_alias').at(-1).args.p_alias, '');
    assert.equal(d.querySelector('.convname').textContent, 'afventer@example.invalid', 'e-mail is back after clearing');
    await e.close();
});

test('a pending row without e-mail ("Venter på den anden part") can be nicknamed too, with no empty "Oprindeligt navn"', async () => {
    const e = await env(false, false, pending('nomail')); const { w, d } = e;
    assert.equal(d.querySelector('.convname').textContent, 'Venter på den anden part');
    await openNickname(w, d);
    assert.ok(d.querySelector('dialog[open] #contact-alias-input'));
    assert.ok(!d.querySelector('.alias-original'), 'no empty original-name line');
    await type(w, d, 'Mor'); await click(button(d, 'Gem')); await delay(60);
    assert.equal(d.querySelector('.convname').textContent, 'Mor');
    assert.equal(d.querySelector('.convprev').textContent, 'venter på accept');
    await e.close();
});

test('save failure keeps the sheet open with an error and does not change the list', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await openNickname(w, d); await type(w, d, 'Far');
    w.__QA_ALIAS_ERROR = true;
    await click(button(d, 'Gem')); await delay(60);
    assert.ok(d.querySelector('dialog[open]'), 'sheet stays open');
    assert.match(d.querySelector('dialog[open] [role=alert]').textContent, /kunne ikke bekræfte/);
    assert.equal(d.querySelector('.convname').textContent, 'afventer@example.invalid');
    w.__QA_ALIAS_ERROR = false;
    await click(button(d, 'Gem')); await delay(60);
    assert.equal(d.querySelector('.convname').textContent, 'Far', 'retry works');
    await e.close();
});

test('accepted conversation: contact nickname still works through the ordinary contact RPC', async () => {
    const e = await env(); const { w, d } = e;
    await longPress(w, d); await type(w, d, 'Kontakt');
    await click(button(d, 'Gem')); await delay(60);
    assert.equal(rpcs(w, 'set_contact_alias').length, 1);
    assert.equal(rpcs(w, 'set_invitation_alias').length, 0);
    assert.equal(d.querySelector('.convname').textContent, 'Kontakt');
    await e.close();
});
