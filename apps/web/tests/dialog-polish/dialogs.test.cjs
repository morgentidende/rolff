// Synthetic UI checks for the dialog/sheet polish. Mocked Supabase only (see back-navigation/mock-supabase.ts).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { env, delay, button, label, click } = require('../back-navigation/support.cjs');
const src = f => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
const css = src('styles.css');

test('Kaldenavn: no autofill of own emails, neutral placeholder, two-button row, reset only when an alias exists', { timeout: 8000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await delay(30);
    const dlg = d.querySelector('dialog.contact-alias-dialog[open]'); assert.ok(dlg);
    const input = d.getElementById('contact-alias-input');
    assert.equal(input.getAttribute('name'), 'contact-nickname');
    assert.equal(input.getAttribute('autocomplete'), 'off');
    assert.equal(input.getAttribute('inputmode'), 'text');
    assert.equal(input.getAttribute('type'), 'text');
    assert.equal(input.getAttribute('placeholder'), 'Skriv et kaldenavn');
    assert.ok(!/@/.test(input.getAttribute('placeholder')), 'placeholder never shows an email');
    assert.match(d.getElementById('contact-alias-original').textContent, /kontakt@example\.invalid/, 'original name shown as help text instead');
    const actions = dlg.querySelector('.dialog-actions'); assert.ok(actions);
    assert.deepEqual([...actions.querySelectorAll('button')].map(b => b.textContent), ['Annuller', 'Gem']);
    assert.ok(![...dlg.querySelectorAll('button')].some(b => b.textContent === 'Nulstil kaldenavn'), 'no reset without an alias');
  } finally { await fx.close(); }
});

test('Deltagere og roller: one-line name + role line, compact Indstillinger, separated outlined Forlad with in-app confirm', { timeout: 8000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    await click(d.querySelector('.convbtn')); await delay(40);
    await click(label(d, 'Menu')); await click(button(d, 'Deltagere og roller')); await delay(40);
    const rows = [...d.querySelectorAll('.member-list > li')]; assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.querySelector('.member-name').textContent), ['Dig', 'Testkontakt']);
    assert.deepEqual(rows.map(r => r.querySelector('.member-role').textContent), ['Part', 'Part']);
    const set = rows[1].querySelector('button.member-settings');
    assert.equal(set.textContent.trim(), 'Indstillinger'); assert.equal(set.getAttribute('aria-label'), 'Indstillinger for Testkontakt');
    assert.ok(!d.body.textContent.includes('Indstillinger for denne person'));
    const leave = d.querySelector('.member-leave button'); assert.ok(leave.classList.contains('danger-outline')); assert.equal(leave.textContent, 'Forlad samtalen');
    assert.ok(d.querySelector('.member-note').compareDocumentPosition(leave) & 4, 'leave sits below the help text, in its own block');
    await click(leave); await delay(20);
    assert.ok(d.querySelector('.confirm-card'), 'in-app confirm before leaving');
    assert.ok(!w.QA.calls.some(c => c.name === 'leave_conversation'), 'nothing happens before confirming');
  } finally { await fx.close(); }
});

test('CSS: composer hidden behind any modal; sheets and dialogs sit above the keyboard; buttons never wrap', () => {
  assert.match(css, /:root:has\(dialog\[open\]\) \.chat-wrap \.card\.composer,:root:has\(\.overlay\) \.chat-wrap \.card\.composer\{visibility:hidden\}/);
  assert.match(css, /\.chat-wrap \.card\.composer dialog\[open\]\{visibility:visible\}/, 'dialogs inside the composer stay visible');
  assert.match(css, /\.overlay\{bottom:var\(--kbd-inset,0px\)\}/);
  assert.match(css, /\.contact-alias-dialog\{bottom:var\(--kbd-inset,0px\);max-height:min\(88dvh,calc\(var\(--vv-h,100dvh\)/);
  assert.match(css, /dialog\.composer-upgrade,dialog\.blocking-dialog\{bottom:var\(--kbd-inset,0px\)/);
  assert.match(css, /\.dialog-actions button\{[^}]*white-space:nowrap/);
  assert.match(css, /\.member-name\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(css, /\.member-text\{flex:1;min-width:0/);
  assert.match(css, /button\[aria-disabled=true\]\{opacity:\.55\}/);
});

test('viewportVars: keyboard inset = layout height minus the visible viewport', async () => {
  const out = await esbuild.build({ entryPoints: [path.join(__dirname, '../../src/viewport.ts')], bundle: true, write: false, format: 'cjs', logLevel: 'silent' });
  const m = { exports: {} }; new Function('module', 'exports', out.outputFiles[0].text)(m, m.exports);
  const { viewportVars } = m.exports;
  assert.deepEqual(viewportVars({ innerHeight: 844, visualViewport: { height: 514, offsetTop: 0 } }), { vh: 514, inset: 330 });
  assert.deepEqual(viewportVars({ innerHeight: 844, visualViewport: { height: 514, offsetTop: 100 } }), { vh: 514, inset: 230 });
  assert.deepEqual(viewportVars({ innerHeight: 800, visualViewport: null }), { vh: 800, inset: 0 });
});

test('Non-credential fields never invite address/email autofill', () => {
  const app = src('App.tsx'), alias = src('ContactAlias.tsx'), exp = src('ConversationExport.tsx'), bl = src('BlockingLists.tsx');
  assert.match(alias, /name="contact-nickname" type="text" inputMode="text" autoComplete="off"/);
  assert.match(exp, /id="export-email" name="recipient-email" type="email" inputMode="email" autoComplete="off"/);
  assert.match(app, /const inviteEmailProps = \{ name: "invitee-email", type: "email", inputMode: "email", enterKeyHint: "send", autoComplete: "off"/);
  assert.match(app, /id="rb" name="report-description" autoComplete="off"/);
  assert.match(app, /id="fb" name="feedback" autoComplete="off"/);
  assert.match(bl, /id="blocked-word"[^>]*autoComplete="off"/);
  assert.match(bl, /id="blocked-topic"[^>]*autoComplete="off"/);
});

test('Feedback and Slet konto: tapping an incomplete form explains why and moves focus', { timeout: 8000 }, async () => {
  const fx = await env(false); const { w, d } = fx;
  try {
    await click(label(d, 'Menu')); await click(button(d, 'Feedback')); await delay(30);
    const send = button(d, 'Send feedback'); assert.equal(send.disabled, false); assert.equal(send.getAttribute('aria-disabled'), 'true');
    send.closest('form').requestSubmit(); await delay(20);
    assert.equal(d.getElementById('fb-hint').textContent, 'Skriv din feedback for at sende.'); assert.equal(d.activeElement, d.getElementById('fb'));
    assert.ok(!w.QA.calls.some(c => c.name === 'feedback'));
    await click(d.querySelector('.sheethead button.icon')); await delay(20);
    await click(label(d, 'Menu')); await click(button(d, 'Privatliv og sletning')); await delay(40);
    const del = button(d, 'Slet min konto permanent'); assert.equal(del.getAttribute('aria-disabled'), 'true');
    del.closest('form').requestSubmit(); await delay(20);
    assert.match(d.getElementById('delpw-hint').textContent, /Skriv din adgangskode/); assert.equal(d.activeElement, d.getElementById('delpw'));
    const pw = d.getElementById('delpw'); Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(pw, 'x'); pw.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(10);
    del.closest('form').requestSubmit(); await delay(20);
    assert.equal(d.getElementById('delack-hint').textContent, 'Sæt flueben i ”Jeg forstår …” for at slette.'); assert.equal(d.activeElement, d.getElementById('delack'));
    assert.equal(d.getElementById('delack').getAttribute('aria-describedby'), 'delack-hint');
    await click(d.getElementById('delack')); assert.ok(!d.getElementById('delack-hint'), 'cleared when ticked');
  } finally { await fx.close(); }
});

test('Front page: pills row, dismissible press-and-hold tip remembered in localStorage, hidden after first use', { timeout: 8000 }, async () => {
  let fx = await env(false); let { w, d } = fx;
  try {
    assert.ok(!d.querySelector('.convlist-head h2'));
    const pills = [...d.querySelectorAll('.convlist-head button')].map(b => b.textContent.trim());
    assert.equal(pills[pills.length - 1], 'Inviter person');
    const hint = d.querySelector('.convhint'); assert.ok(hint); assert.match(hint.textContent, /Hold fingeren på en samtale/);
    await click(hint.querySelector('button[aria-label="Skjul tip"]'));
    assert.equal(d.querySelector('.convhint'), null); assert.equal(w.localStorage.getItem('convHintDismissed'), '1');
  } finally { await fx.close(); }
  fx = await env(false); ({ w, d } = fx);
  try {
    assert.ok(d.querySelector('.convhint'), 'fresh device shows the tip');
    d.querySelector('.convbtn').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await delay(30);
    assert.equal(d.querySelector('.convhint'), null, 'gone after the gesture was used once'); assert.equal(w.localStorage.getItem('convHintDismissed'), '1');
  } finally { await fx.close(); }
});
