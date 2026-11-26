const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
const cid = '20000000-0000-4000-8000-000000000001';

const menuItems = (d) => [...d.querySelectorAll('.menu [role=menuitem],.menu [role=menuitemcheckbox]')].map((b) => b.querySelector('.menu-label').textContent.trim());
const menuItem = (d, text) => {
    const b = [...d.querySelectorAll('.menu button')].find((el) => el.querySelector('.menu-label')?.textContent.trim() === text);
    assert.ok(b, 'menu item: ' + text + ' in ' + JSON.stringify(menuItems(d)));
    return b;
};
const muteCalls = (w) => w.QA.calls.filter((c) => /conversation_mute$/.test(c.name || ''));
const radios = (d) => [...d.querySelectorAll('.mute-card input[type=radio]')];
const optionTexts = (d) => [...d.querySelectorAll('.mute-card .mute-option')].map((l) => l.textContent.trim());
async function openChat(w, d) { await click(d.querySelector('.convbtn')); await delay(40); }
async function openMenu(d) { await click(label(d, 'Menu')); }
function fresh(w) { w.__QA_MUTES = []; w.__QA_MUTE_ERROR = false; }
async function setup(opts = {}) {
    const e = await env();
    fresh(e.w);
    return e;
}

test('chat menu has "Lydløs"; the dialog offers 8 timer, 24 timer, 1 uge and Altid with ✕/OK', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d);
    assert.ok(menuItems(d).includes('Lydløs'));
    assert.ok(!menuItems(d).includes('Slå lyd til'), 'nothing to unmute yet');
    await click(menuItem(d, 'Lydløs'));
    const dlg = d.querySelector('[role=dialog].mute-card');
    assert.ok(dlg, 'dialog opens');
    assert.deepEqual(optionTexts(d), ['8 timer', '24 timer', '1 uge', 'Altid']);
    assert.equal(radios(d).length, 4);
    assert.equal(radios(d).filter((r) => r.checked).length, 1);
    assert.equal(radios(d)[0].checked, true, '8 timer is preselected');
    assert.ok(dlg.querySelector('button[aria-label="Luk"]')); assert.ok(button(d, 'OK'));
    assert.ok(![...dlg.querySelectorAll('button')].some(b => /^(Annuller|Cancel)$/.test(b.textContent.trim())));
    assert.ok(!dlg.textContent.includes('Slå lyd til'), 'no unmute while not muted');
    assert.match(dlg.textContent, /den anden part kan ikke se/i);
    await e.close();
});

test('✕ closes without saving; nothing is sent to the server', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d); await click(menuItem(d, 'Lydløs'));
    await click(radios(d)[1]);
    await click(d.querySelector('.mute-card button[aria-label="Luk"]'));
    assert.equal(d.querySelector('.mute-card'), null);
    assert.equal(muteCalls(w).length, 0);
    await openMenu(d);
    assert.ok(menuItems(d).includes('Lydløs'));
    await e.close();
});

test('24 timer + OK stores it server-side, the menu shows the state and "Slå lyd til" undoes it', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d); await click(menuItem(d, 'Lydløs'));
    await click(radios(d)[1]); await click(button(d, 'OK'));
    const calls = muteCalls(w);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'set_my_conversation_mute');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), { conv: cid, p_duration: '24h' });
    assert.equal(d.querySelector('.mute-card'), null);
    await openMenu(d);
    const items = menuItems(d);
    const state = items.find((t) => t.startsWith('Lydløs til'));
    assert.ok(state, 'state shown: ' + JSON.stringify(items));
    assert.match(state, /^Lydløs til (i morgen )?\d{2}\.\d{2}$/);
    assert.ok(items.includes('Slå lyd til'));
    await click(menuItem(d, 'Slå lyd til'));
    assert.deepEqual([...muteCalls(w)].map((c) => c.name), ['set_my_conversation_mute', 'clear_my_conversation_mute']);
    await openMenu(d);
    assert.ok(menuItems(d).includes('Lydløs')); assert.ok(!menuItems(d).includes('Slå lyd til'));
    await e.close();
});

test('each duration maps to the server value; Altid shows "Lydløs altid"', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d);
    for (const [i, v] of [[0, '8h'], [1, '24h'], [2, '1w'], [3, 'always']]) {
        await openMenu(d);
        const open = [...d.querySelectorAll('.menu button')].find((el) => /^Lydløs/.test(el.querySelector('.menu-label').textContent) );
        await click(open);
        await click(radios(d)[i]); await click(button(d, 'OK'));
        assert.equal(muteCalls(w).at(-1).args.p_duration, v);
    }
    await openMenu(d);
    assert.ok(menuItems(d).includes('Lydløs altid'));
    await e.close();
});

test('an already muted chat shows its state in the dialog and offers "Slå lyd til" there too', async () => {
    const e = await env(); const { d, w } = e;
    w.__QA_MUTES = [{ conversation_id: cid, mute_until: null, always: true }]; w.__QA_MUTE_ERROR = false;
    await click(d.querySelector('.convbtn')); await delay(60);
    await openMenu(d); await click(menuItem(d, 'Lydløs altid'));
    assert.match(d.querySelector('.mute-card .mute-state').textContent, /Lydløs altid/);
    await click(d.querySelector('.mute-card .mute-unmute'));
    assert.equal(muteCalls(w).at(-1).name, 'clear_my_conversation_mute');
    assert.equal(d.querySelector('.mute-card'), null);
    await e.close();
});

test('a failed save keeps the old state and tells the user', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); w.__QA_MUTE_ERROR = true;
    await openMenu(d); await click(menuItem(d, 'Lydløs')); await click(button(d, 'OK'));
    await openMenu(d);
    assert.ok(menuItems(d).includes('Lydløs'), 'still not muted');
    await e.close();
});

test('front page: a small muted icon shows on the muted conversation row, for the owner only; expired mutes show nothing', async () => {
    const e = await env(); const { d, w } = e;
    assert.equal(d.querySelector('.convmuted'), null, 'no icon without a mute');
    w.__QA_MUTES = [{ conversation_id: cid, mute_until: new Date(Date.now() + 3600e3).toISOString(), always: false }];
    await click(d.querySelector('.convbtn')); await delay(40);
    await click(label(d, 'Tilbage')); await delay(60);
    const icon = d.querySelector('.convrow .convmuted');
    assert.ok(icon, 'icon on the row'); assert.equal(icon.getAttribute('aria-label'), 'Lydløs');
    assert.equal(icon.getAttribute('role'), 'img');
    assert.ok(!d.querySelector('.convrow').textContent.includes('Lydløs'), 'no text, icon only');
    w.__QA_MUTES = [{ conversation_id: cid, mute_until: new Date(Date.now() - 1000).toISOString(), always: false }];
    await click(d.querySelector('.convbtn')); await delay(40);
    await click(label(d, 'Tilbage')); await delay(60);
    assert.equal(d.querySelector('.convmuted'), null, 'expired mute is not shown');
    await e.close();
});

test('mute is only per-user client state: the app never sends mute data in messages or to anyone else', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d); await click(menuItem(d, 'Lydløs')); await click(button(d, 'OK'));
    const others = w.QA.calls.filter((c) => c.function);
    assert.equal(others.length, 0, 'no edge function call (send-message etc.) carries or triggers mute data');
    assert.ok(!JSON.stringify(w.QA.calls.filter((c) => c.name && !/conversation_mute/.test(c.name))).includes('p_duration'));
    await e.close();
});

test('English: Mute, 8 hours, 24 hours, 1 week, Always, Close/OK, "Muted always", "Unmute"', async () => {
    const e = await setup(); const { d, w } = e;
    await click(label(d, 'Menu')); await click(button(d, 'Sprog'));
    await click([...d.querySelectorAll('.sheet .choice')].find((c) => c.textContent.includes('English')));
    await delay(40);
    await openChat(w, d); await openMenu(d);
    assert.ok(menuItems(d).includes('Mute'));
    await click(menuItem(d, 'Mute'));
    assert.deepEqual(optionTexts(d), ['8 hours', '24 hours', '1 week', 'Always']);
    assert.ok(d.querySelector('.mute-card button[aria-label="Close"]')); assert.ok(button(d, 'OK'));
    assert.ok(![...d.querySelectorAll('.mute-card button')].some(b => /^(Annuller|Cancel)$/.test(b.textContent.trim())));
    assert.match(d.querySelector('.mute-card').textContent, /cannot see that it is muted/);
    await click(radios(d)[3]); await click(button(d, 'OK'));
    await openMenu(d);
    assert.ok(menuItems(d).includes('Muted always')); assert.ok(menuItems(d).includes('Unmute'));
    await e.close();
});
