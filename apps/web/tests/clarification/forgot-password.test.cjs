const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { env, delay, button, label, click } = require('./support.cjs');

function fill(w, el, value) {
    const proto = w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
}

const SENT_DA = 'Hvis adressen findes, har vi sendt et link. Tjek også spam.';
const SENT_EN = 'If the address exists, we have sent a link. Check spam too.';

test('login link opens a forgot-password card with X only; confirmation is enumeration-safe', { timeout: 8000 }, async () => {
    const fx = await env(false, true);
    const { w, d } = fx;
    try {
        assert.ok(button(d, 'Glemt adgangskode?'));
        assert.ok(!d.querySelector('[role=dialog][aria-label="Glemt adgangskode"]'));
        await click(button(d, 'Glemt adgangskode?'));
        const dlg = d.querySelector('[role=dialog][aria-label="Glemt adgangskode"]');
        assert.ok(dlg);
        assert.ok(dlg.querySelector('button[aria-label="Luk"]'));
        assert.ok(![...dlg.querySelectorAll('button')].some((b) => /^(Annuller|Cancel|Log ind)$/.test(b.textContent.trim())), 'no Annuller or Log ind close');
        fill(w, dlg.querySelector('#re'), 'ukendt@example.invalid');
        await click(button(dlg, 'Send link'));
        await delay(40);
        assert.equal(dlg.querySelector('[role=status]').textContent.trim(), SENT_DA);
        const recover = w.QA.calls.filter((c) => c.function === 'account-mail' && c.args?.action === 'recover');
        assert.equal(recover.length, 1);
        assert.equal(recover[0].args.email, 'ukendt@example.invalid');
        await click(dlg.querySelector('button[aria-label="Luk"]'));
        await delay(20);
        w.QA.setRecoverResult('throw');
        await click(button(d, 'Glemt adgangskode?'));
        const dlg2 = d.querySelector('[role=dialog][aria-label="Glemt adgangskode"]');
        fill(w, dlg2.querySelector('#re'), 'kendt@example.invalid');
        await click(button(dlg2, 'Send link'));
        await delay(40);
        assert.equal(dlg2.querySelector('[role=status]').textContent.trim(), SENT_DA, 'same text when the request fails');
    } finally { await fx.close(); }
});

test('Konto has the forgot link under current password and pre-fills the account email', { timeout: 8000 }, async () => {
    const fx = await env(false);
    const { d } = fx;
    try {
        await click(label(d, 'Menu'));
        await click(button(d, 'Konto (e-mail og adgangskode)'));
        await delay(40);
        const card = d.querySelector('[role=dialog][aria-label="Konto"]');
        assert.ok(card);
        const emailLine = card.querySelector('.account-email');
        assert.ok(emailLine);
        assert.match(emailLine.textContent, /Din e-mail:/);
        assert.ok(!emailLine.classList.contains('meta'));
        const cur = d.getElementById('cp');
        const link = [...card.querySelectorAll('button.linkish')].find((b) => b.textContent.trim() === 'Glemt adgangskode?');
        assert.ok(link, 'forgot link');
        assert.ok(cur.compareDocumentPosition(link) & 4, 'link is after the current-password field');
        await click(link);
        await delay(40);
        const recover = d.querySelector('[role=dialog][aria-label="Glemt adgangskode"]');
        assert.ok(recover);
        assert.equal(recover.querySelector('#re').value, 'tester@example.invalid');
        assert.ok(recover.querySelector('button[aria-label="Luk"]'));
        assert.ok(![...recover.querySelectorAll('button')].some((b) => /^(Annuller|Cancel)$/.test(b.textContent.trim())));
    } finally { await fx.close(); }
});

test('Konto email line uses the same font-size as field labels', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../src/styles.css'), 'utf8');
    const label = css.match(/^label\{[^}]*font-size:(\d+)px/m);
    const email = css.match(/\.account-email\{[^}]*font-size:(\d+)px/);
    assert.ok(label && email, 'rules present');
    assert.equal(label[1], '14');
    assert.equal(email[1], label[1]);
});

test('live match and mismatch on Konto and the reset page, independent of the eye toggle', { timeout: 8000 }, async () => {
    const fx = await env(false);
    const { w, d } = fx;
    try {
        await click(label(d, 'Menu'));
        await click(button(d, 'Konto (e-mail og adgangskode)'));
        await delay(40);
        assert.equal(d.querySelector('label[for=cp2]').textContent, 'Gentag adgangskode');
        fill(w, d.getElementById('cp1'), 'hemmelig1');
        fill(w, d.getElementById('cp2'), 'forkert99');
        await delay(20);
        let note = d.querySelector('#cperr');
        assert.equal(note.textContent.trim(), 'Koderne er ikke ens');
        assert.ok(note.classList.contains('is-mismatch'));
        assert.equal(note.getAttribute('aria-live'), 'polite');
        assert.equal(d.getElementById('cp1').type, 'password');
        assert.equal(d.getElementById('cp2').type, 'password');
        const eyes = [...d.querySelectorAll('#cp1, #cp2')].map((el) => el.parentElement.querySelector('button.eye'));
        for (const eye of eyes) await click(eye);
        assert.equal(d.getElementById('cp1').type, 'text');
        assert.equal(d.getElementById('cp2').type, 'text');
        assert.equal(d.querySelector('#cperr').textContent.trim(), 'Koderne er ikke ens', 'mismatch still visible with eyes open');
        for (const eye of eyes) await click(eye);
        assert.equal(d.getElementById('cp1').type, 'password');
        fill(w, d.getElementById('cp2'), 'hemmelig1');
        await delay(20);
        note = d.querySelector('#cperr');
        assert.equal(note.textContent.trim().replace(/^✓\s*/, ''), 'Koderne er ens');
        assert.ok(note.classList.contains('is-match'));
        assert.ok(note.querySelector('.pw-pair-mark'), 'green check is not colour only');
        assert.equal(d.getElementById('cp1').type, 'password');
        assert.equal(d.getElementById('cp2').type, 'password');
        await click(d.querySelector('[role=dialog][aria-label="Konto"] .sheethead button.icon'));
        await delay(20);
    } finally { await fx.close(); }

    const rec = await env(false, false, 'auth=recovery&th=abcdefgh123');
    try {
        const { w, d } = rec;
        let dlg;
        for (let i = 0; i < 40 && !(dlg = d.querySelector('[role=dialog][aria-label="Vælg ny adgangskode"]')); i++) await delay(50);
        assert.ok(dlg, 'new password card from recovery link');
        assert.ok(dlg.querySelector('button[aria-label="Luk"]'));
        assert.equal(d.querySelector('label[for=np2]').textContent, 'Gentag adgangskode');
        fill(w, d.getElementById('np'), 'nytpass1');
        fill(w, d.getElementById('np2'), 'nytpass2');
        await delay(20);
        assert.equal(d.querySelector('#nperr').textContent.trim(), 'Koderne er ikke ens');
        fill(w, d.getElementById('np2'), 'nytpass1');
        await delay(20);
        assert.match(d.querySelector('#nperr').textContent, /Koderne er ens/);
        assert.equal(d.getElementById('np').type, 'password');
        await click(button(dlg, 'Gem'));
        await delay(40);
        assert.match(dlg.textContent, /Ny adgangskode gemt/);
        const upd = w.QA.calls.filter((c) => c.function === 'auth.updateUser');
        assert.equal(upd.length, 1);
        assert.equal(upd[0].args.password, 'nytpass1');
    } finally { await rec.close(); }
});

test('signup also shows live match text and uses Gentag adgangskode', { timeout: 8000 }, async () => {
    const fx = await env(false, true);
    const { w, d } = fx;
    try {
        await click(button(d, 'Opret konto'));
        assert.equal(d.querySelector('label[for=p2]').textContent, 'Gentag adgangskode');
        fill(w, d.getElementById('p'), 'hemmelig1');
        fill(w, d.getElementById('p2'), 'x');
        await delay(20);
        assert.equal(d.querySelector('#pwerr').textContent.trim(), 'Koderne er ikke ens');
        fill(w, d.getElementById('p2'), 'hemmelig1');
        await delay(20);
        assert.match(d.querySelector('#pwerr').textContent, /Koderne er ens/);
    } finally { await fx.close(); }
});

test('delete-account transcript checkbox is on by default; export failure aborts deletion', { timeout: 8000 }, async () => {
    const fx = await env(false);
    const { w, d } = fx;
    try {
        await click(label(d, 'Menu'));
        await click(button(d, 'Konto (e-mail og adgangskode)'));
        await delay(40);
        const box = d.getElementById('delexport');
        assert.ok(box);
        assert.equal(box.checked, true);
        const row = box.closest('label');
        assert.match(row.textContent, /Send mig en fuld udskrift af alle mine samtaler, før kontoen slettes/);
        fill(w, d.getElementById('delpw'), 'hemmelig1');
        await click(d.getElementById('delack'));
        w.QA.setDeleteResult({ status: 502, data: { error: 'export_failed' } });
        button(d, 'Slet konto, slet alle data og opsig abonnement').closest('form').requestSubmit();
        await delay(40);
        assert.match(d.querySelector('.err[role=alert]').textContent, /Udskriften kunne ikke sendes/);
        const del = w.QA.calls.filter((c) => c.function === 'delete-account');
        assert.equal(del.length, 1);
        assert.equal(del[0].args.email_transcript, true);
        assert.equal(del[0].args.password, 'hemmelig1');
        w.QA.setDeleteResult({ status: 500, data: { error: 'delete_failed' } });
        await click(box);
        assert.equal(box.checked, false);
        button(d, 'Slet konto, slet alle data og opsig abonnement').closest('form').requestSubmit();
        await delay(40);
        const del2 = w.QA.calls.filter((c) => c.function === 'delete-account');
        assert.equal(del2[1].args.email_transcript, false);
        assert.ok(!/\?deleted=1/.test(w.location.href), 'account was not deleted');
    } finally { await fx.close(); }
});
