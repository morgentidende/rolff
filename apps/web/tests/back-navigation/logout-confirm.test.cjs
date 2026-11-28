const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click, back } = require('./support.cjs');

async function openLogoutCard(d) {
    await click(label(d, 'Menu'));
    await click(button(d, 'Log ud'));
    await delay(40);
    const card = d.querySelector('.confirm-card');
    assert.ok(card, 'logout confirm card');
    return card;
}

function cardButtons(card) {
    const dismiss = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Bliv logget ind' || b.textContent.trim() === 'Stay logged in');
    const ok = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Log ud' || b.textContent.trim() === 'Log out');
    return { dismiss, ok };
}

test('Log ud opens a confirm card and does not sign out until confirmed', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        assert.ok(d.querySelector('.convbtn'));
        const card = await openLogoutCard(d);
        assert.equal(card.querySelector('#confirm-title')?.textContent, 'Sikker på, at du vil logge ud?');
        assert.match(card.textContent, /Dine beskeder bliver\. Du kan logge ind igen\./);
        assert.ok(card.querySelector('[aria-label="Luk"]'), 'X-only close');
        assert.ok(![...card.querySelectorAll('button')].some((b) => /Annuller/.test(b.textContent)));
        const { dismiss, ok } = cardButtons(card);
        assert.ok(dismiss && ok);
        assert.equal(dismiss.textContent.trim(), 'Bliv logget ind');
        assert.equal(ok.textContent.trim(), 'Log ud');
        assert.ok(ok.classList.contains('danger'), 'destructive confirm');
        assert.ok(ok.closest('.confirm-actions.end'), 'primary on the right');
        assert.equal(card.querySelector('.confirm-actions.end').lastElementChild, ok);
        assert.ok(d.querySelector('.convbtn'), 'still signed in while the card is open');
        assert.ok(!d.querySelector('input[type=email]'), 'login form is not shown yet');
    } finally {
        await fixture.close();
    }
});

test('Bliv logget ind, X, outside tap and Back close the card without signing out', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        let card = await openLogoutCard(d);
        await click(cardButtons(card).dismiss);
        await delay(30);
        assert.ok(!d.querySelector('.confirm-card'));
        assert.ok(d.querySelector('.convbtn'), 'Stay logged in keeps the session');

        card = await openLogoutCard(d);
        await click(card.querySelector('[aria-label="Luk"]'));
        await delay(30);
        assert.ok(!d.querySelector('.confirm-card'));
        assert.ok(d.querySelector('.convbtn'), 'X keeps the session');

        card = await openLogoutCard(d);
        const overlay = d.querySelector('.confirm-overlay');
        assert.ok(overlay);
        overlay.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        overlay.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        await delay(40);
        assert.ok(!d.querySelector('.confirm-card'), 'outside tap closes the card');
        assert.ok(d.querySelector('.convbtn'));

        card = await openLogoutCard(d);
        await back(w);
        await delay(40);
        assert.ok(!d.querySelector('.confirm-card'), 'Back closes the card');
        assert.ok(d.querySelector('.convbtn'), 'Back does not sign out');
    } finally {
        await fixture.close();
    }
});

test('Confirming Log ud signs out, and an unsent draft in localStorage is left as before', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        const draftKey = 'draft:20000000-0000-4000-8000-000000000001';
        w.localStorage.setItem(draftKey, 'Kun en opdigtet kladde.');
        const card = await openLogoutCard(d);
        await click(cardButtons(card).ok);
        await delay(60);
        assert.ok(!d.querySelector('.confirm-card'));
        assert.ok(!d.querySelector('.convbtn'), 'signed out');
        assert.ok(d.querySelector('input[type=email]'), 'login form is shown');
        assert.equal(w.localStorage.getItem(draftKey), 'Kun en opdigtet kladde.', 'composer drafts are not cleared on logout');
    } finally {
        await fixture.close();
    }
});

test('English logout confirm copy', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { d } = fixture;
    try {
        await click(label(d, 'Menu'));
        await click(button(d, 'App-sprog'));
        const en = [...d.querySelectorAll('.sheet .choice')].find((c) => c.textContent.includes('English'));
        assert.ok(en);
        await click(en.querySelector('input'));
        await delay(40);
        const close = d.querySelector('.sheet [aria-label="Close"], .sheet [aria-label="Luk"]');
        if (close) await click(close);
        await delay(20);
        await click(label(d, 'Menu'));
        await click(button(d, 'Log out'));
        await delay(40);
        const card = d.querySelector('.confirm-card');
        assert.ok(card);
        assert.equal(card.querySelector('#confirm-title')?.textContent, 'Are you sure you want to log out?');
        assert.match(card.textContent, /Your messages are kept\. You can log in again\./);
        const { dismiss, ok } = cardButtons(card);
        assert.equal(dismiss.textContent.trim(), 'Stay logged in');
        assert.equal(ok.textContent.trim(), 'Log out');
        assert.ok(ok.classList.contains('danger'));
        assert.ok(card.querySelector('[aria-label="Close"]'));
    } finally {
        await fixture.close();
    }
});
