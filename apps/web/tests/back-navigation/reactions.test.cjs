const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('./support.cjs');
const menuLabel = (b) => (b.querySelector('span:last-child') || b).textContent.trim();
const menuButton = (d, text) => {
    const b = [...d.querySelectorAll('.message-panel [role=menuitem]')].find((el) => menuLabel(el) === text);
    assert.ok(b, 'menuitem: ' + text);
    return b;
};

const otherMsg = {
    id: '40000000-0000-4000-8000-000000000010',
    sender_id: '30000000-0000-4000-8000-000000000001',
    sender_email: 'kontakt@example.invalid',
    body: 'Kan vi aftale afhentning kl. 16?',
    created_at: '2026-11-07T07:58:00Z',
    mine: false,
    thumb_count: 1,
    i_thumbed: false,
};
const mineMsg = {
    id: '40000000-0000-4000-8000-000000000001',
    sender_id: '10000000-0000-4000-8000-000000000001',
    sender_email: 'tester@example.invalid',
    body: 'Ja, det passer fint.',
    created_at: '2026-11-07T08:00:00Z',
    mine: true,
};

async function openChat(w, d, messages) {
    w.__QA_FIXTURE = { messages: messages.map((m) => ({ ...m })) };
    await click(d.querySelector('.convbtn'));
    await delay(40);
}

async function toEnglish(d) {
    await click(label(d, 'Menu'));
    await click(button(d, 'Sprog'));
    const en = [...d.querySelectorAll('.sheet .choice')].find((c) => c.textContent.includes('English'));
    assert.ok(en);
    await click(en.querySelector('input'));
    await delay(40);
    const close = d.querySelector('.sheet [aria-label="Close"], .sheet [aria-label="Luk"]');
    if (close) await click(close);
    await delay(20);
}

test('message menu lists 👍 first, and a reacted bubble shows the pill', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        await openChat(w, d, [otherMsg, mineMsg]);
        const theirs = d.querySelector('.msg.theirs');
        assert.ok(theirs && theirs.classList.contains('has-thumb'));
        const pill = theirs.querySelector('.msg-thumb');
        assert.ok(pill);
        assert.equal(pill.textContent.replace(/\s+/g, ''), '👍');
        assert.equal(pill.getAttribute('aria-label'), '👍 på beskeden');
        theirs.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await delay(30);
        const items = [...d.querySelectorAll('.message-panel [role=menuitem]')].map((b) => (b.querySelector('span:last-child') || b).textContent.trim());
        assert.deepEqual(items, ['Svar med 👍', 'Besvar', 'Kopiér', 'Information']);
        const thumb = menuButton(d, 'Svar med 👍');
        assert.equal(thumb.getAttribute('aria-pressed'), 'false');
        assert.equal(thumb.getAttribute('aria-label'), 'Svar på beskeden med 👍');
        await click(thumb);
        assert.ok(!d.querySelector('.message-panel'));
        const updated = d.querySelector('.msg.theirs .msg-thumb');
        assert.ok(updated.classList.contains('is-mine'));
        assert.equal(updated.textContent.replace(/\s+/g, ''), '👍2');
        assert.equal(updated.getAttribute('aria-label'), 'Dit 👍. Tryk for at fjerne.');
    } finally {
        await fixture.close();
    }
});

test('English labels, and tapping your own 👍 removes it', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        await toEnglish(d);
        await openChat(w, d, [{ ...otherMsg, i_thumbed: true, thumb_count: 1 }]);
        const pill = d.querySelector('.msg-thumb');
        assert.ok(pill && pill.classList.contains('is-mine'));
        assert.equal(pill.getAttribute('aria-label'), 'Your 👍. Tap to remove.');
        d.querySelector('.msg.theirs').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await delay(30);
        const items = [...d.querySelectorAll('.message-panel [role=menuitem]')].map((b) => (b.querySelector('span:last-child') || b).textContent.trim());
        assert.deepEqual(items, ['Remove', 'Reply', 'Copy', 'Information']);
        assert.equal(menuButton(d, 'Remove').getAttribute('aria-label'), 'Remove your 👍');
        d.querySelector('.message-overlay').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        await delay(30);
        await click(d.querySelector('.msg-thumb'));
        await delay(40);
        assert.ok(!d.querySelector('.msg-thumb'), 'pill disappears when the last 👍 is removed');
        assert.ok(!d.querySelector('.msg.has-thumb'));
    } finally {
        await fixture.close();
    }
});
