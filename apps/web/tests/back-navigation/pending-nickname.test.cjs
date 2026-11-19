// Contact nickname BEFORE the invitation is accepted (private to the owner). Fully synthetic fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');

const pending = (mode = 'live') => (w) => { w.__QA_PENDING = mode; };
const rows = (d) => [...d.querySelectorAll('.convrow')];
const longPress = async (w, d) => { d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await delay(40); };
const type = async (w, d, v) => {
    const input = d.querySelector('#contact-alias-input'); assert.ok(input, 'nickname field');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, v);
    input.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20);
};
const rpcs = (w, name) => w.QA.calls.filter((c) => c.name === name);

test('pending row shows the e-mail and "venter på accept"; long press opens the nickname sheet (no "kan ændres, når ..." text)', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    assert.equal(d.querySelector('.convname').textContent, 'afventer@example.invalid');
    assert.match(d.querySelector('.convprev').textContent, /venter på accept/);
    await longPress(w, d);
    const dlg = d.querySelector('dialog[open]'); assert.ok(dlg, 'sheet opens on a pending row');
    assert.equal(dlg.querySelector('h2').textContent, 'Kontaktens kaldenavn');
    assert.ok(!/kan ændres, når/.test(dlg.textContent), 'old blocking line is gone');
    assert.match(dlg.textContent, /ikke accepteret endnu/);
    assert.match(dlg.textContent, /aldrig se det/);
    assert.ok(d.querySelector('#contact-alias-input'), 'field is editable');
    assert.ok(!d.querySelector('.alias-reset'), 'nothing to reset yet');
    assert.equal(d.querySelector('.alias-original').textContent, 'afventer@example.invalid');
    await e.close();
});

test('set, show in the list, edit and clear on a pending invitation (RPC set_invitation_alias, never set_contact_alias)', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await longPress(w, d);
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
    await longPress(w, d);
    assert.equal(d.querySelector('#contact-alias-input').value, 'Far');
    await type(w, d, 'Far (arbejde)'); await click(button(d, 'Gem')); await delay(60);
    assert.equal(d.querySelector('.convname').textContent, 'Far (arbejde)');
    // clear via "Nulstil kaldenavn"
    await longPress(w, d);
    await click(button(d, 'Nulstil kaldenavn')); await delay(60);
    assert.equal(rpcs(w, 'set_invitation_alias').at(-1).args.p_alias, '');
    assert.equal(d.querySelector('.convname').textContent, 'afventer@example.invalid', 'e-mail is back after clearing');
    await e.close();
});

test('chat header of a pending conversation shows the nickname and can rename; menu has "Kontaktens kaldenavn"', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await longPress(w, d); await type(w, d, 'Far'); await click(button(d, 'Gem')); await delay(60);
    await click(d.querySelector('.convbtn')); await delay(60);
    if (!d.querySelector('.topbar.chat')) { await click(d.querySelector('.convbtn')); await delay(60); } // the first tap after a long press is swallowed on purpose
    const heading = d.querySelector('.chattitle .contact-heading'); assert.ok(heading, 'header name is a button');
    assert.equal(heading.textContent, 'Far');
    assert.match(d.querySelector('.chattitle').textContent, /venter på accept/);
    await click(heading); assert.ok(d.querySelector('dialog[open] #contact-alias-input'), 'header tap opens the sheet');
    assert.equal(d.querySelector('#contact-alias-input').value, 'Far');
    await click(button(d, 'Annuller'));
    await click(label(d, 'Menu'));
    const item = [...d.querySelectorAll('.menu button')].find((b) => b.querySelector('.menu-label')?.textContent.trim() === 'Kontaktens kaldenavn');
    assert.ok(item, 'menu entry exists while pending');
    await click(item); await delay(30);
    await type(w, d, 'Papa'); await click(button(d, 'Gem')); await delay(60);
    assert.equal(d.querySelector('.chattitle .contact-heading').textContent, 'Papa', 'header updates at once');
    await e.close();
});

test('a pending row without e-mail ("Venter på den anden part") can be nicknamed too, with no empty "Oprindeligt navn"', async () => {
    const e = await env(false, false, pending('nomail')); const { w, d } = e;
    assert.equal(d.querySelector('.convname').textContent, 'Venter på den anden part');
    await longPress(w, d);
    assert.ok(d.querySelector('dialog[open] #contact-alias-input'));
    assert.ok(!d.querySelector('.alias-original'), 'no empty original-name line');
    await type(w, d, 'Mor'); await click(button(d, 'Gem')); await delay(60);
    assert.equal(d.querySelector('.convname').textContent, 'Mor');
    assert.equal(d.querySelector('.convprev').textContent, 'venter på accept');
    await e.close();
});

test('save failure keeps the sheet open with an error and does not change the list', async () => {
    const e = await env(false, false, pending()); const { w, d } = e;
    await longPress(w, d); await type(w, d, 'Far');
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
