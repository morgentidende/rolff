const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click, back, forward, assertPrivateHistory } = require('./support.cjs');
for (const strict of [false, true])
    test(`actual App: 15 navigation regressions (StrictMode=${strict})`, { timeout: 10000 }, async () => {
        const fixture = await env(strict);
        const { w, d } = fixture;
        const result = [];
        try {
            assert.ok(d.querySelector('.convbtn'));
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('initial Home has baseline only');
            await click(label(d, 'Menu'));
            await click(button(d, 'FAQ'));
            assert.ok(d.querySelector('.sheet'));
            await back(w);
            assert.ok(!d.querySelector('.sheet'));
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('Home Menu→FAQ→Back closes FAQ');
            await forward(w);
            assert.ok(!d.querySelector('.sheet'));
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('Forward does not reopen FAQ');
            await click(d.querySelector('.convbtn'));
            assert.ok(d.querySelector('.topbar.chat'));
            assert.ok(d.querySelector('.message-input'));
            assertPrivateHistory(w);
            result.push('Chat entry has guard');
            const input = d.querySelector('textarea');
            const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(input, 'En syntetisk kladde');
            input.dispatchEvent(new w.Event('input', { bubbles: true }));
            await delay(30);
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            await click(label(d, 'Menu'));
            await click(button(d, 'Rapportér'));
            await back(w);
            assert.ok(d.querySelector('.topbar.chat'));
            assert.ok(!d.querySelector('.sheet'));
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            assertPrivateHistory(w);
            result.push('Chat sheet Back preserves draft');
            const msg = d.querySelector('.msg');
            msg.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await delay(20);
            assert.ok(d.querySelector('.message-panel'));
            await click(button(d, 'Information'));
            await back(w);
            assert.ok(button(d, 'Besvar'));
            await back(w);
            assert.ok(!d.querySelector('.message-panel'));
            assert.ok(d.querySelector('.topbar.chat'));
            assertPrivateHistory(w);
            result.push('Message Information→actions→Chat Back');
            await click(label(d, 'Vedhæft fil'));
            assert.ok(d.querySelector('dialog[open]'));
            d.querySelector('dialog[open]').dispatchEvent(new w.Event('cancel', { cancelable: true }));
            await delay(30);
            assert.ok(!d.querySelector('dialog[open]'));
            assert.ok(d.querySelector('.topbar.chat'));
            assertPrivateHistory(w);
            result.push('Native-dialog cancel preserves Chat');
            await click(label(d, 'Vedhæft fil'));
            await click(button(d, 'Se planen til 79 kr.'));
            assert.ok(!d.querySelector('dialog[open]'));
            assert.ok(d.querySelector('.sheet'));
            await back(w);
            assert.ok(!d.querySelector('.sheet'));
            assert.ok(!d.querySelector('dialog[open]'));
            assert.ok(d.querySelector('.topbar.chat'));
            assertPrivateHistory(w);
            result.push('Upgrade→Plans→Back does not resurrect offer');
            await click(label(d, 'Tilføj person'));
            { const me = d.getElementById('me'); Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(me, 'ny@example.invalid'); me.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20); }
            d.querySelector('.sheet form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
            await delay(30);
            await click(button(d, 'Se planer'));
            assert.equal(d.querySelectorAll('.sheet').length, 2);
            await back(w);
            assert.equal(d.querySelectorAll('.sheet').length, 1);
            assert.equal(d.querySelector('.sheet h2').textContent, 'Tilføj person');
            await back(w);
            assert.ok(!d.querySelector('.sheet'));
            assert.equal(d.querySelector('textarea').value, 'En syntetisk kladde');
            assertPrivateHistory(w);
            result.push('Chat local addMember→root Plans→local sheet→Chat');
            await click(label(d, 'Menu'));
            await click(button(d, 'Deltagere og roller'));
            assert.ok(d.querySelector('.sheet'));
            await back(w);
            assert.ok(!d.querySelector('.sheet'));
            await back(w);
            assert.ok(d.querySelector('.convbtn'));
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('Members→Chat→Home Back');
            await longPressAlias(w, d);
            assert.ok(d.querySelector('dialog[open]'));
            await back(w);
            assert.ok(!d.querySelector('dialog[open]'));
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('Alias history Back closes native dialog');
            await click(label(d, 'Menu'));
            await click(button(d, 'FAQ'));
            await click(label(d, 'Luk'));
            await delay(30);
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('Explicit X prunes last guard');
            await longPressAlias(w, d);
            d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await delay(30);
            assert.ok(!d.querySelector('dialog[open]'));
            assert.equal(w.history.state.__rolffBack.kind, 'base');
            assertPrivateHistory(w);
            result.push('Escape dismisses alias and guard once');
            await click(d.querySelector('.convbtn'));
            // Log ud lives on the front-page menu only; the chat stays in the forward history.
            await back(w);
            await click(label(d, 'Menu'));
            await click(button(d, 'Log ud'));
            await delay(30);
            assert.ok(!d.querySelector('.topbar.chat'), 'Chat should be closed');
            assert.ok(!d.querySelector('.convbtn'), 'Home should not remain after signout');
            await forward(w);
            assert.ok(!d.querySelector('.topbar.chat'), 'Chat should be closed');
            assertPrivateHistory(w);
            result.push('Logout and Forward expose no old Chat');
            assertPrivateHistory(w);
            assertPrivateHistory(w);
            result.push('History marker contains no synthetic private content');
            assert.equal(result.length, 15);
        }
        finally {
            await fixture.close();
        }
    });
// Namespaced sibling keys must prevent orphaned private DOM after alias dismissal.
for (const strict of [false, true])
    for (const alias of [false, true]) {
        test(`logout removes all private DOM (StrictMode=${strict}, alias first=${alias})`, { timeout: 5000 }, async () => {
            const fixture = await env(strict);
            const { w, d } = fixture;
            try {
                if (alias) {
                    await longPressAlias(w, d);
                    await back(w);
                }
                await click(d.querySelector('.convbtn'));
                await back(w);
                await click(label(d, 'Menu'));
                await click(button(d, 'Log ud'));
                await delay(50);
                assert.equal(d.querySelectorAll('.convbtn').length, 0, 'No stale contact rows after signout');
                assert.ok(!d.querySelector('.topbar.chat'));
                assert.ok(d.querySelector('input[type=email]'));
                assert.ok(!d.body.textContent.includes('kontakt@example.invalid'));
                await forward(w);
                assert.ok(!d.querySelector('.topbar.chat'));
                assert.equal(d.querySelectorAll('.convbtn').length, 0);
                assertPrivateHistory(w);
            }
            finally {
                await fixture.close();
            }
        });
    }
// The visible pencil is gone from the list; the private nickname opens via long-press/context menu.
async function longPressAlias(w, d) {
    d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await delay(25);
}
function homeKey(d) {
    const node = d.querySelector('.convlist');
    if (!node)
        return null;
    // Test-only introspection of the mounted component key, not application data.
    const k = Object.keys(node).find(k => k.startsWith('__reactFiber'));
    let f = node[k];
    while (f) {
        if (f.type?.name === 'Home')
            return f.key;
        f = f.return;
    }
    return null;
}
for (const strict of [false, true])
    test(`late initial auth cannot overwrite callback B (StrictMode=${strict})`, { timeout: 5000 }, async () => {
        const fixture = await env(strict, true);
        const { w, d } = fixture;
        try {
            assert.ok(!d.querySelector('.convbtn'));
            const b = '10000000-0000-4000-8000-000000000002';
            w.QA.changeUser(b);
            await delay(35);
            assert.equal(homeKey(d), 'home:' + b);
            w.QA.resolveInitial();
            await delay(35);
            assert.equal(homeKey(d), 'home:' + b);
            w.QA.emitInitial();
            await delay(35);
            assert.equal(homeKey(d), 'home:' + b);
            assertPrivateHistory(w);
        }
        finally {
            await fixture.close();
        }
    });
for (const strict of [false, true])
    test(`alias RPC pins UI account A while account changes to B (StrictMode=${strict})`, { timeout: 5000 }, async () => {
        const fixture = await env(strict);
        const { w, d } = fixture;
        try {
            w.QA.pauseAlias();
            await longPressAlias(w, d);
            const input = d.querySelector('#contact-alias-input');
            Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, 'Syntetisk navn');
            input.dispatchEvent(new w.Event('input', { bubbles: true }));
            await delay(20);
            await click(button(d, 'Gem'));
            const call = w.QA.calls.find(c => c.name === 'set_contact_alias');
            assert.ok(call, 'Alias mutation started');
            assert.equal(call.headers.Authorization, 'Bearer ' + w.QA.TOKEN_A);
            const b = '10000000-0000-4000-8000-000000000002';
            w.QA.changeUser(b);
            await delay(30);
            assert.equal(homeKey(d), 'home:' + b);
            await click(d.querySelector('.convbtn'));
            w.QA.resolveAlias();
            await delay(40);
            assert.equal(call.headers.Authorization, 'Bearer ' + w.QA.TOKEN_A);
            assert.notEqual(call.headers.Authorization, 'Bearer ' + w.QA.TOKEN_B);
            assert.ok(d.querySelector('.topbar.chat'), 'B remains in its own Chat');
            assert.ok(!d.querySelector('dialog[open]'));
            assert.ok(!d.body.textContent.includes('Syntetisk navn'), 'Late A save must not relabel B UI');
            assertPrivateHistory(w);
        }
        finally {
            await fixture.close();
        }
    });
