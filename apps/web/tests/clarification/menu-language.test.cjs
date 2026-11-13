// Front-page ⋮ menu: every sheet opens as a card at the top, the language applies at once,
// invitations carry the app language, and the self-chosen display name is gone. Synthetic data only.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { env, delay, label, click } = require('./support.cjs');
const items = (d) => [...d.querySelectorAll('[role=menuitem]')];
async function openItem(d, text) {
  await click(label(d, 'Menu')); const it = items(d).find(b => b.textContent.trim() === text); assert.ok(it, `menu item ${text}`);
  await click(it); await delay(60); const s = d.querySelector('.sheet'); assert.ok(s, `${text} sheet`); return s;
}
async function closeSheet(d) { const x = d.querySelector('.sheet [aria-label="Luk"], .sheet [aria-label="Close"]'); if (x) await click(x); await delay(40); }

test('all front-page menu sheets open as a top card anchored to ⋮ (like "Tilføj person")', async () => {
  const f = await env(); const { d } = f; try {
    for (const name of ['Sprog', 'Tema', 'Modtagetider', 'FAQ', 'Abonnement', 'Konto (e-mail og adgangskode)', 'Privatliv og sletning', 'Feedback', 'Inviter person']) {
      await click(label(d, 'Menu')); const it = items(d).find(b => b.textContent.trim() === name);
      if (!it) { assert.fail(`missing ${name}: ${items(d).map(i => i.textContent).join(', ')}`); }
      await click(it); await delay(60);
      const s = d.querySelector('.sheet'); assert.ok(s, name);
      assert.ok(s.classList.contains('anchored-card'), `${name} is an anchored top card`);
      assert.ok(s.closest('.overlay').classList.contains('anchored-overlay'), `${name} overlay`);
      await closeSheet(d);
    }
  } finally { await f.close(); }
});

test('self-chosen display name is removed: no menu item, no hint, no public-name RPCs', async () => {
  const f = await env(); const { w, d } = f; try {
    await click(label(d, 'Menu'));
    const labels = items(d).map(i => i.textContent.trim());
    assert.ok(!labels.some(l => /visningsnavn|display name/i.test(l)), labels.join(', '));
    await click(label(d, 'Menu'));
    assert.ok(!/Vælg kaldenavn|Mit navn – det andre ser/.test(d.body.textContent));
    assert.equal(w.QA.calls.filter(c => /public_name/.test(c.name ?? c.function ?? '')).length, 0);
    const faq = await openItem(d, 'FAQ');
    assert.ok(!/Visningsnavn/.test(faq.textContent)); assert.match(faq.textContent, /du kan ikke selv vælge et andet navn/);
  } finally { await f.close(); }
});

test('language: switching applies at once (menu, html lang, storage) and invitations carry it', async () => {
  const f = await env(); const { w, d } = f; try {
    const inviteLang = async (menuName, btnRe) => {
      const s = await openItem(d, menuName);
      const input = s.querySelector('input[type=email]'); assert.ok(input, 'email input');
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set; setter.call(input, 'synthetic@example.invalid');
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      const submit = [...s.querySelectorAll('button[type=submit],button')].find(b => btnRe.test(b.textContent)); assert.ok(submit, 'submit');
      await click(submit); await delay(60);
      assert.equal(d.querySelector('.sheet input[type=email]'), null, 'invite success closes the sheet');
      const c = w.QA.calls.filter(x => x.function === 'invite-email').pop(); assert.ok(c, 'invite-email called');
      await closeSheet(d); return c.args.lang;
    };
    assert.equal(await inviteLang('Inviter person', /Send|Inviter/), 'da');
    const s = await openItem(d, 'Sprog');
    const en = [...s.querySelectorAll('.choice')].find(c => c.textContent.includes('English')); await click(en.querySelector('input')); await delay(40);
    assert.equal(d.documentElement.lang, 'en'); assert.equal(w.localStorage.getItem('lang'), 'en');
    assert.equal(d.querySelector('.sheet h2').textContent, 'Language', 'open sheet re-renders in English without reload');
    await closeSheet(d);
    await click(label(d, 'Menu')); const labels = items(d).map(i => i.textContent.trim()); await click(label(d, 'Menu'));
    assert.ok(labels.includes('Plan') && labels.includes('Privacy and deletion') && labels.includes('Invite person'), labels.join(', '));
    assert.equal(await inviteLang('Invite person', /Send|Invite/), 'en');
  } finally { await f.close(); }
});

test('Feedback: only Forslag/Klage, fixed-size box with 2000 limit and counter', async () => {
  const f = await env(); const { w, d } = f; try {
    const s = await openItem(d, 'Feedback');
    assert.deepEqual([...s.querySelectorAll('#fc option')].map(o => [o.value, o.textContent]), [['suggestion', 'Forslag'], ['complaint', 'Klage']]);
    const ta = s.querySelector('#fb'); assert.equal(ta.maxLength, 2000); assert.ok(ta.classList.contains('feedback-text'));
    assert.equal(s.querySelector('#fb-count').textContent, '0/2000'); assert.equal(ta.getAttribute('aria-describedby'), 'fb-count');
    const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, 'Hej æøå'); ta.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20);
    assert.equal(s.querySelector('#fb-count').textContent, '7/2000');
    assert.ok(!/kaldenavn/.test(s.textContent));
  } finally { await f.close(); }
});

test('Privatliv og sletning: equal headings, themed checkboxes, delete last in a danger card', async () => {
  const f = await env(); const { d } = f; try {
    const s = await openItem(d, 'Privatliv og sletning'); await delay(60);
    const heads = [...s.querySelectorAll('.privacy h3')];
    assert.deepEqual(heads.map(h => h.textContent), ['Opbevaring og synkronisering', 'Download mine data', 'Automatisk sletning ved inaktivitet', 'Slet min konto']);
    assert.ok(heads.every(h => h.classList.contains('psec-h')));
    const secs = [...s.querySelectorAll('.privacy > section')]; const last = secs[secs.length - 1];
    assert.ok(last.classList.contains('danger-card')); assert.equal(last.querySelector('h3').textContent, 'Slet min konto');
    assert.ok(last.querySelector('#delpw') && last.querySelector('input.check') && last.querySelector('button.danger'));
    assert.ok(last.querySelector('p.meta'), 'delete body uses normal body size');
    assert.equal(s.querySelectorAll('input[type=checkbox]').length, 3); assert.ok([...s.querySelectorAll('input[type=checkbox]')].every(c => c.classList.contains('check') && c.closest('label.check-row')));
    assert.match(s.textContent, /Hent en kopi af dine data/);
  } finally { await f.close(); }
});

test('front page: visible "Inviter person" button above the list opens the same top invite sheet', async () => {
  const f = await env(); const { d } = f; try {
    const head = d.querySelector('.convlist-head'); assert.ok(head, 'list header');
    assert.ok(!head.querySelector('h2'), 'no visible Samtaler heading in the row'); assert.ok(d.querySelector('#convlist-title.sr-only'), 'list keeps an accessible name');
    const web = head.querySelector('button.webapp-btn'); assert.ok(web, 'Download webapp pill'); assert.equal(web.textContent.trim(), 'Download webapp'); assert.ok(web.getAttribute('aria-label'));
    assert.ok(web.compareDocumentPosition(head.querySelector('button.invite-btn:not(.webapp-btn)')) & 4, 'webapp pill left of Inviter person');
    const btn = head.querySelector('button.invite-btn:not(.webapp-btn)'); assert.ok(btn); assert.equal(btn.textContent.trim(), 'Inviter person');
    assert.ok(btn.compareDocumentPosition(d.querySelector('.convitems')) & 4, 'button is before the list');
    assert.equal(btn.querySelector('svg').getAttribute('aria-hidden'), 'true');
    await click(btn); await delay(60);
    const s = d.querySelector('.sheet'); assert.equal(s.getAttribute('aria-label'), 'Inviter person'); assert.ok(s.classList.contains('anchored-card'));
    assert.match(s.textContent, /De andre i samtalen ser din e-mail\. De kan selv give dig et privat kaldenavn, som kun de ser\./);
    assert.ok(!/Mit visningsnavn|indtil du vælger/.test(s.textContent));
    await closeSheet(d);
    await click(label(d, 'Menu')); assert.ok(items(d).some(i => i.textContent.trim() === 'Inviter person'), 'menu entry kept'); await click(label(d, 'Menu'));
  } finally { await f.close(); }
});
