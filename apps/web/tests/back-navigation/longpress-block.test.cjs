const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click, back } = require('./support.cjs');

const menuLabel = (b) => (b.querySelector('span:last-child') || b).textContent.trim();
const menuItems = (d) => [...d.querySelectorAll('.message-panel [role=menuitem]')].map(menuLabel);
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

function mockBlockingFetch(w) {
    const adds = [];
    const inner = w.fetch;
    w.fetch = async (url, opts) => {
        const u = String(url);
        const method = String(opts?.method || 'GET').toUpperCase();
        if (u.includes('conversation_blocked_words') || u.includes('conversation_blocked_topics'))
            return { ok: true, status: 200, json: async () => [] };
        if (u.includes('get_my_attachment_blocks'))
            return { ok: true, status: 200, json: async () => ({ block_photos: false, block_files: false }) };
        if (u.includes('add_blocked_word') || u.includes('add_blocked_topic') || u.includes('remove_blocked_') || u.includes('set_my_attachment_blocks')) {
            adds.push({ url: u, method, body: opts?.body ?? null });
            return { ok: true, status: 200, json: async () => ({ id: '60000000-0000-4000-8000-000000000001' }) };
        }
        return inner(url, opts);
    };
    return adds;
}

async function openTheirsMenu(w, d) {
    const theirs = d.querySelector('.msg.theirs');
    assert.ok(theirs);
    theirs.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await delay(30);
    return theirs;
}

async function waitLists(d) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
        if (d.querySelector('.blocking-empty, .blocking-entries')) return;
        await delay(15);
    }
    throw new Error('Blokeringer lists did not load');
}

async function selectWord(w, d, word) {
    const content = d.querySelector('.msg.theirs .message-content');
    assert.ok(content);
    const node = [...content.childNodes].find((n) => n.nodeType === 3 && String(n.textContent).includes(word));
    assert.ok(node, 'text node with ' + word);
    const start = node.textContent.indexOf(word);
    const range = d.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + word.length);
    const sel = w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    assert.equal(sel.toString(), word);
}

test('Blokér ord eller emne is only on the other person\'s message, not on your own', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        await openChat(w, d, [otherMsg, mineMsg]);
        await openTheirsMenu(w, d);
        assert.deepEqual(menuItems(d), ['Svar med 👍', 'Besvar', 'Kopiér', 'Blokér ord eller emne', 'Information']);
        const overlay = d.querySelector('.message-overlay');
        overlay.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        overlay.dispatchEvent(new w.Event('pointerup', { bubbles: true }));
        overlay.click();
        await delay(30);
        assert.ok(!d.querySelector('.message-panel'));
        const mine = d.querySelector('.msg.mine');
        assert.ok(mine);
        mine.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await delay(30);
        assert.deepEqual(menuItems(d), ['Svar med 👍', 'Besvar', 'Kopiér', 'Information']);
        assert.ok(!menuItems(d).includes('Blokér ord eller emne'));
    } finally {
        await fixture.close();
    }
});

test('chooser opens Blokeringer on the word section with captured selection, and adds nothing until confirm', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        const adds = mockBlockingFetch(w);
        await openChat(w, d, [otherMsg, mineMsg]);
        await selectWord(w, d, 'afhentning');
        await openTheirsMenu(w, d);
        await click(menuButton(d, 'Blokér ord eller emne'));
        await delay(40);
        assert.ok(!d.querySelector('.message-panel'));
        assert.match(d.querySelector('.sheet').textContent, /Blokér ord eller emne/);
        assert.match(d.querySelector('.sheet').textContent, /Intet tilføjes, før du bekræfter det/);
        assert.ok(button(d, 'Blokér ord'));
        assert.ok(button(d, 'Blokér emne'));
        await click(button(d, 'Blokér ord'));
        await waitLists(d);
        const title = d.querySelector('#blocked-words-title');
        assert.ok(title, 'Blokeringer word section is shown');
        const field = d.getElementById('blocked-word');
        assert.ok(field);
        assert.equal(field.value, 'afhentning');
        assert.equal(d.getElementById('blocked-topic').value, '');
        const ack = d.querySelector('#blocked-word').form.querySelector('.blocking-ack input');
        assert.equal(ack.checked, false);
        const words = [...d.querySelector('#blocked-words-title').closest('section').querySelectorAll('li span')].map((x) => x.textContent);
        assert.ok(!words.includes('afhentning'), 'prefill is not auto-added');
        assert.equal(adds.length, 0, 'no add/remove RPC until the user confirms');
        assert.equal(d.activeElement, field);
    } finally {
        await fixture.close();
    }
});

test('Blokér emne opens the topic section, and X / outside tap / Back close the chooser', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        mockBlockingFetch(w);
        await openChat(w, d, [otherMsg, mineMsg]);
        await openTheirsMenu(w, d);
        await click(menuButton(d, 'Blokér ord eller emne'));
        await delay(40);
        await click(button(d, 'Blokér emne'));
        await waitLists(d);
        assert.ok(d.getElementById('blocked-topics-title'));
        assert.equal(d.getElementById('blocked-topic').value, otherMsg.body, 'without a selection the message is prefilled');
        assert.equal(d.activeElement, d.getElementById('blocked-topic'));
        const closeLists = d.querySelector('.sheet [aria-label="Luk"]');
        await click(closeLists);
        await delay(30);
        assert.ok(!d.querySelector('.sheet'));

        await openTheirsMenu(w, d);
        await click(menuButton(d, 'Blokér ord eller emne'));
        await delay(40);
        await click(d.querySelector('.sheet [aria-label="Luk"]'));
        await delay(30);
        assert.ok(!d.querySelector('.sheet'), 'X closes the chooser');

        await openTheirsMenu(w, d);
        await click(menuButton(d, 'Blokér ord eller emne'));
        await delay(40);
        const overlay = d.querySelector('.overlay');
        assert.ok(overlay);
        overlay.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        overlay.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        await delay(40);
        assert.ok(!d.querySelector('.sheet'), 'outside tap closes the chooser');

        await openTheirsMenu(w, d);
        await click(menuButton(d, 'Blokér ord eller emne'));
        await delay(40);
        assert.match(d.querySelector('.sheet').textContent, /Blokér ord eller emne/);
        await back(w);
        await delay(40);
        assert.ok(!d.querySelector('.sheet'), 'Back closes the chooser');
    } finally {
        await fixture.close();
    }
});

test('English labels on the other person\'s menu and chooser', { timeout: 10000 }, async () => {
    const fixture = await env(false);
    const { w, d } = fixture;
    try {
        mockBlockingFetch(w);
        await click(label(d, 'Menu'));
        await click(button(d, 'App-sprog'));
        const en = [...d.querySelectorAll('.sheet .choice')].find((c) => c.textContent.includes('English'));
        assert.ok(en);
        await click(en.querySelector('input'));
        await delay(40);
        const close = d.querySelector('.sheet [aria-label="Close"], .sheet [aria-label="Luk"]');
        if (close) await click(close);
        await delay(20);
        await openChat(w, d, [otherMsg, mineMsg]);
        await openTheirsMenu(w, d);
        assert.deepEqual(menuItems(d), ['Reply with 👍', 'Reply', 'Copy', 'Block word or topic', 'Information']);
        await click(menuButton(d, 'Block word or topic'));
        await delay(40);
        assert.match(d.querySelector('.sheet').textContent, /Block word or topic/);
        assert.match(d.querySelector('.sheet').textContent, /Nothing is added until you confirm it/);
        await click(button(d, 'Block word'));
        await waitLists(d);
        assert.equal(d.getElementById('blocked-words-title').textContent, 'Blocked words');
        assert.equal(d.getElementById('blocked-word').value, otherMsg.body);
        assert.equal(d.querySelector('.sheet [aria-label="Close"], .sheet [aria-label="Luk"]').getAttribute('aria-label'), 'Close');
    } finally {
        await fixture.close();
    }
});
