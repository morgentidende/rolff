// Ret on a delayed message pauses it on the server and in the UI. Mocked Supabase only (fabricated data, no network).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { env, delay, button, label, click } = require('../back-navigation/support.cjs');

const mine = (over = {}) => ({
    id: '40000000-0000-4000-8000-0000000000aa',
    sender_id: '10000000-0000-4000-8000-000000000001',
    sender_email: 'tester@example.invalid',
    body: 'Godmorgen hej',
    created_at: '2026-11-07T08:00:00Z',
    mine: true,
    deliver_after: new Date(Date.now() + 20000).toISOString(),
    held: false,
    ...over,
});
const hold = (w) => w.QA.calls.filter((c) => c.name === 'hold_delayed_message');
const resume = (w) => w.QA.calls.filter((c) => c.function === 'send-message' && c.args.resume_message_id);
async function open(w, d, messages) {
    w.__QA_FIXTURE = { messages };
    await click(d.querySelector('.convbtn'));
    await delay(60);
}
const banner = (d) => d.querySelector('.reply-composer');
const composer = (d) => d.querySelector('textarea');

test('Ret: the server hold is requested first, the countdown disappears ("sat på pause"), the editor opens with the original text', async () => {
    const e = await env(); const { w, d } = e;
    await open(w, d, [mine()]);
    assert.match(d.querySelector('.msg-pending-sec').textContent, /\d+ s/, 'counting before Ret');
    assert.ok(d.querySelector('.composer-send.is-countdown'), 'ring on the send button before Ret');
    await click(button(d, 'Ret')); await delay(80);
    assert.equal(hold(w).length, 1);
    assert.equal(hold(w)[0].args.p_id, '40000000-0000-4000-8000-0000000000aa');
    assert.match(banner(d).textContent, /Retter besked/);
    assert.match(banner(d).textContent, /sat på pause/);
    assert.equal(composer(d).value, 'Godmorgen hej');
    const sec = d.querySelector('.msg-pending-sec');
    assert.equal(sec.textContent.trim().replace(/^·\s*/, ''), 'sat på pause');
    assert.doesNotMatch(sec.textContent, /\d+ s/, 'no seconds while paused');
    assert.equal(d.querySelector('.composer-send.is-countdown'), null, 'no ring/countdown on Send while paused');
    // The countdown stays stopped, even after the old 20 s would have elapsed (clock moved forward).
    await delay(300);
    assert.equal(w.QA.calls.filter((c) => c.name === 'release_delayed_message').length, 0, 'never sent now / auto-released while held');
    assert.deepEqual([...d.querySelectorAll('.msg-pending-actions button')].map((b) => b.textContent), ['Ret', 'Genoptag', 'Slet']);
    await e.close();
});

test('Race: already delivered when Ret is tapped -> clear message, editor does not open, nothing edited', async () => {
    const e = await env(); const { w, d } = e;
    w.__QA_HOLD_RESULT = 'sent';
    await open(w, d, [mine()]);
    await click(button(d, 'Ret')); await delay(80);
    assert.equal(hold(w).length, 1);
    assert.equal(banner(d)?.textContent?.includes('Retter besked') ?? false, false, 'no editor');
    assert.equal(composer(d).value, '');
    assert.match(d.body.textContent, /Beskeden er allerede sendt, så den kan ikke rettes\./);
    assert.equal(w.QA.calls.filter((c) => c.function === 'send-message').length, 0);
    await e.close();
});

test('Annullér rettelse (X): the delay restarts in full with the unchanged original and the countdown returns', async () => {
    const e = await env(); const { w, d } = e;
    await open(w, d, [mine()]);
    await click(button(d, 'Ret')); await delay(80);
    await click(label(d, 'Annullér rettelse')); await delay(100);
    assert.equal(resume(w).length, 1);
    assert.equal(banner(d), null);
    assert.equal(composer(d).value, '');
    assert.match(d.querySelector('.msg-pending-sec').textContent, /\d+ s/, 'countdown is back');
    const secs = parseInt(d.querySelector('.msg-pending-sec').textContent.replace(/\D/g, ''), 10);
    assert.ok(secs >= 28 && secs <= 30, 'fresh full delay, got ' + secs);
    await e.close();
});

test('A message that is still paused (app was closed while editing) shows "sat på pause" with Genoptag; Genoptag resumes with a fresh delay', async () => {
    const e = await env(); const { w, d } = e;
    await open(w, d, [mine({ held: true, deliver_after: null })]);
    assert.match(d.querySelector('.msg-pending-sec').textContent, /sat på pause/);
    assert.equal(d.querySelector('.composer-send.is-countdown'), null);
    assert.equal(w.QA.calls.filter((c) => c.name === 'release_delayed_message').length, 0);
    await click(button(d, 'Genoptag')); await delay(100);
    assert.equal(resume(w).length, 1);
    assert.match(d.querySelector('.msg-pending-sec').textContent, /\d+ s/);
    await e.close();
});

const notDelivered = (w) => assert.equal(w.QA.calls.filter((c) => c.name === 'release_delayed_message').length, 0);

test('Resume (X) re-moderates the stored text on the server first: the request is a full send-message call with resume_message_id', async () => {
    const e = await env(); const { w, d } = e;
    await open(w, d, [mine()]);
    await click(button(d, 'Ret')); await delay(80);
    await click(label(d, 'Annullér rettelse')); await delay(100);
    assert.equal(resume(w).length, 1);
    assert.equal(resume(w)[0].args.resume_message_id, '40000000-0000-4000-8000-0000000000aa');
    assert.equal(w.QA.calls.filter((c) => /^resume_delayed_message$/.test(c.name || '')).length, 0, 'no client-side un-pause RPC exists');
    await e.close();
});

for (const [mode, re] of [['blocked', /anklagende/], ['blocked_word', /blokeret ordet\/sætningen "syntetisk"/], ['private_boundary', /blokeret et emne|privat modtagerindstilling/], ['technical', /./]]) {
    test(`Resume that now hits a block (${mode}): stays paused, normal block reply is shown, editor opens, nothing is sent`, async () => {
        const e = await env(); const { w, d } = e;
        w.__QA_RESUME_RESULT = mode;
        await open(w, d, [mine({ held: true, deliver_after: null })]);
        await click(button(d, 'Genoptag')); await delay(120);
        assert.equal(resume(w).length, 1);
        assert.match(d.querySelector('.msg-pending-sec').textContent, /sat på pause/, 'still paused');
        assert.equal(d.querySelector('.composer-send.is-countdown'), null);
        assert.match(banner(d).textContent, /sat på pause/, 'editor open on the held text');
        assert.equal(composer(d).value, 'Godmorgen hej');
        if (mode !== 'technical') assert.match(d.body.textContent, re);
        notDelivered(w);
        await e.close();
    });
}

test('Blocked on resume from the X button: editor stays open with the sender\'s own text; X again retries the check', async () => {
    const e = await env(); const { w, d } = e;
    await open(w, d, [mine()]);
    await click(button(d, 'Ret')); await delay(80);
    w.__QA_RESUME_RESULT = 'blocked';
    await click(label(d, 'Annullér rettelse')); await delay(100);
    assert.ok(banner(d), 'editor still open');
    assert.match(d.body.textContent, /anklagende/);
    assert.match(d.querySelector('.msg-pending-sec').textContent, /sat på pause/);
    w.__QA_RESUME_RESULT = 'accepted';
    await click(label(d, 'Annullér rettelse')); await delay(100);
    assert.equal(resume(w).length, 2);
    assert.equal(banner(d), null);
    assert.match(d.querySelector('.msg-pending-sec').textContent, /\d+ s/, 'countdown is back');
    await e.close();
});

test('Resume when the message is already gone: clear toast, editor closes', async () => {
    const e = await env(); const { w, d } = e;
    await open(w, d, [mine({ held: true, deliver_after: null })]);
    w.__QA_RESUME_RESULT = 'gone';
    await click(button(d, 'Genoptag')); await delay(100);
    assert.match(d.body.textContent, /findes ikke længere som ventende/);
    assert.equal(banner(d), null);
    await e.close();
});
