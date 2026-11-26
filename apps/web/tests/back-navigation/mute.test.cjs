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
const closeBtn = (d) => d.querySelector('.mute-card button[aria-label="Luk"], .mute-card button[aria-label="Close"]');
async function openChat(w, d) { await click(d.querySelector('.convbtn')); await delay(40); }
async function openMenu(d) { await click(label(d, 'Menu')); }
function fresh(w) { w.__QA_MUTES = []; w.__QA_MUTE_ERROR = false; }
async function setup(opts = {}) {
    const e = await env();
    fresh(e.w);
    return e;
}

test('chat menu has "Slå notifikationer fra"; the dialog offers 8 timer, 1 uge and Altid with X and OK, no Annuller', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d);
    assert.ok(menuItems(d).includes('Slå notifikationer fra'));
    assert.ok(!menuItems(d).includes('Slå notifikationer til'), 'nothing to unmute yet');
    await click(menuItem(d, 'Slå notifikationer fra'));
    const dlg = d.querySelector('[role=dialog].mute-card');
    assert.ok(dlg, 'dialog opens');
    assert.equal(dlg.querySelector('#mute-title').textContent, 'Slå notifikationer fra');
    assert.deepEqual(optionTexts(d), ['8 timer', '1 uge', 'Altid']);
    assert.equal(radios(d).length, 3);
    assert.equal(radios(d).filter((r) => r.checked).length, 1);
    assert.equal(radios(d)[0].checked, true, '8 timer is preselected');
    const x = closeBtn(d);
    assert.ok(x, 'X close is present');
    assert.equal(x.getAttribute('aria-label'), 'Luk');
    assert.ok(button(d, 'OK'));
    assert.equal([...d.querySelectorAll('.mute-card button')].find((b) => b.textContent.trim() === 'Annuller'), undefined, 'no Annuller when X is present');
    await e.close();
});

test('X closes without saving; nothing is sent to the server; Escape does the same', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d); await click(menuItem(d, 'Slå notifikationer fra'));
    await click(radios(d)[1]);
    await click(closeBtn(d));
    assert.equal(d.querySelector('.mute-card'), null);
    assert.equal(muteCalls(w).length, 0);
    await openMenu(d); await click(menuItem(d, 'Slå notifikationer fra'));
    d.querySelector('.mute-card').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await delay(20);
    assert.equal(d.querySelector('.mute-card'), null);
    assert.equal(muteCalls(w).length, 0);
    await openMenu(d);
    assert.ok(menuItems(d).includes('Slå notifikationer fra'));
    await e.close();
});

test('1 uge + OK stores it server-side; the menu then says "Slå notifikationer til" and tapping it unmutes immediately', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d); await click(menuItem(d, 'Slå notifikationer fra'));
    await click(radios(d)[1]); await click(button(d, 'OK'));
    const calls = muteCalls(w);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'set_my_conversation_mute');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), { conv: cid, p_duration: '1w' });
    assert.equal(d.querySelector('.mute-card'), null);
    await openMenu(d);
    const items = menuItems(d);
    assert.ok(items.includes('Slå notifikationer til'), 'unmute item: ' + JSON.stringify(items));
    assert.ok(!items.includes('Slå notifikationer fra'));
    await click(menuItem(d, 'Slå notifikationer til'));
    assert.equal(d.querySelector('.mute-card'), null, 'unmute does not open the dialog');
    assert.deepEqual([...muteCalls(w)].map((c) => c.name), ['set_my_conversation_mute', 'clear_my_conversation_mute']);
    await openMenu(d);
    assert.ok(menuItems(d).includes('Slå notifikationer fra')); assert.ok(!menuItems(d).includes('Slå notifikationer til'));
    await e.close();
});

test('each duration maps to the server value', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d);
    for (const [i, v] of [[0, '8h'], [1, '1w'], [2, 'always']]) {
        await openMenu(d);
        await click(menuItem(d, 'Slå notifikationer fra'));
        await click(radios(d)[i]); await click(button(d, 'OK'));
        assert.equal(muteCalls(w).at(-1).args.p_duration, v);
        if (v !== 'always') {
            await openMenu(d);
            await click(menuItem(d, 'Slå notifikationer til'));
        }
    }
    await openMenu(d);
    assert.ok(menuItems(d).includes('Slå notifikationer til'));
    await e.close();
});

test('an already muted chat offers "Slå notifikationer til" and tapping it unmutes without a dialog', async () => {
    const e = await env(); const { d, w } = e;
    w.__QA_MUTES = [{ conversation_id: cid, mute_until: null, always: true }]; w.__QA_MUTE_ERROR = false;
    await click(d.querySelector('.convbtn')); await delay(60);
    await openMenu(d);
    assert.ok(menuItems(d).includes('Slå notifikationer til'));
    assert.ok(!menuItems(d).includes('Slå notifikationer fra'));
    await click(menuItem(d, 'Slå notifikationer til'));
    assert.equal(d.querySelector('.mute-card'), null);
    assert.equal(muteCalls(w).at(-1).name, 'clear_my_conversation_mute');
    await e.close();
});

test('a failed save keeps the old state and tells the user', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); w.__QA_MUTE_ERROR = true;
    await openMenu(d); await click(menuItem(d, 'Slå notifikationer fra')); await click(button(d, 'OK'));
    await openMenu(d);
    assert.ok(menuItems(d).includes('Slå notifikationer fra'), 'still not muted');
    await e.close();
});

test('front page: a grey muted bell sits on the preview line under the timestamp; expired mutes show nothing; it updates after mute/unmute', async () => {
    const e = await env(); const { d, w } = e;
    assert.equal(d.querySelector('.convmuted'), null, 'no icon without a mute');
    w.__QA_MUTES = [{ conversation_id: cid, mute_until: new Date(Date.now() + 3600e3).toISOString(), always: false }];
    await click(d.querySelector('.convbtn')); await delay(40);
    await click(label(d, 'Tilbage')); await delay(60);
    const icon = d.querySelector('.convrow .convmuted');
    assert.ok(icon, 'icon on the row'); assert.equal(icon.getAttribute('aria-label'), 'Lydløs');
    assert.equal(icon.getAttribute('role'), 'img');
    assert.ok(icon.closest('.convmeta'), 'icon is on the preview line');
    assert.ok(!icon.closest('.convtop'), 'icon is not on the name/time line');
    assert.ok(d.querySelector('.convtop .convtime'), 'timestamp stays on the top line');
    assert.ok(icon.querySelector('svg'), 'uses the shared muted-bell glyph');
    assert.ok(!d.querySelector('.convrow').textContent.includes('Lydløs'), 'no text, icon only');
    w.__QA_MUTES = [{ conversation_id: cid, mute_until: new Date(Date.now() - 1000).toISOString(), always: false }];
    await click(d.querySelector('.convbtn')); await delay(40);
    await click(label(d, 'Tilbage')); await delay(60);
    assert.equal(d.querySelector('.convmuted'), null, 'expired mute is not shown');
    w.__QA_MUTES = [];
    await click(d.querySelector('.convbtn')); await delay(40);
    await openMenu(d); await click(menuItem(d, 'Slå notifikationer fra')); await click(button(d, 'OK'));
    await click(label(d, 'Tilbage')); await delay(60);
    assert.ok(d.querySelector('.convrow .convmuted'), 'icon appears after muting');
    await click(d.querySelector('.convbtn')); await delay(40);
    await openMenu(d); await click(menuItem(d, 'Slå notifikationer til'));
    await click(label(d, 'Tilbage')); await delay(60);
    assert.equal(d.querySelector('.convmuted'), null, 'icon disappears after unmuting');
    await e.close();
});

test('mute is only per-user client state: the app never sends mute data in messages or to anyone else', async () => {
    const e = await setup(); const { d, w } = e;
    await openChat(w, d); await openMenu(d); await click(menuItem(d, 'Slå notifikationer fra')); await click(button(d, 'OK'));
    const others = w.QA.calls.filter((c) => c.function);
    assert.equal(others.length, 0, 'no edge function call (send-message etc.) carries or triggers mute data');
    assert.ok(!JSON.stringify(w.QA.calls.filter((c) => c.name && !/conversation_mute/.test(c.name))).includes('p_duration'));
    await e.close();
});

test('English: Mute notifications, 8 hours, 1 week, Always, Close/OK, then Unmute notifications', async () => {
    const e = await setup(); const { d, w } = e;
    await click(label(d, 'Menu')); await click(button(d, 'Sprog'));
    await click([...d.querySelectorAll('.sheet .choice')].find((c) => c.textContent.includes('English')));
    await delay(40);
    await openChat(w, d); await openMenu(d);
    assert.ok(menuItems(d).includes('Mute notifications'));
    await click(menuItem(d, 'Mute notifications'));
    assert.equal(d.querySelector('#mute-title').textContent, 'Mute notifications');
    assert.deepEqual(optionTexts(d), ['8 hours', '1 week', 'Always']);
    assert.equal(closeBtn(d).getAttribute('aria-label'), 'Close');
    assert.ok(button(d, 'OK'));
    assert.equal([...d.querySelectorAll('.mute-card button')].find((b) => b.textContent.trim() === 'Cancel'), undefined, 'no Cancel when X is present');
    await click(radios(d)[2]); await click(button(d, 'OK'));
    await openMenu(d);
    assert.ok(menuItems(d).includes('Unmute notifications'));
    assert.ok(!menuItems(d).includes('Mute notifications'));
    await e.close();
});
