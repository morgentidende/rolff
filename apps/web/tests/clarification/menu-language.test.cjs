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
    for (const name of ['App-sprog', 'FAQ', 'Abonnement', 'Konto (e-mail og adgangskode)', 'Privatliv og sletning', 'Kontakt', 'Invitér til Rolff']) {
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
    assert.equal(await inviteLang('Invitér til Rolff', /Send|Inviter/), 'da');
    const s = await openItem(d, 'App-sprog');
    const en = [...s.querySelectorAll('.choice')].find(c => c.textContent.includes('English')); await click(en.querySelector('input')); await delay(40);
    assert.equal(d.documentElement.lang, 'en'); assert.equal(w.localStorage.getItem('lang'), 'en');
    assert.equal(d.querySelector('.sheet h2').textContent, 'App language', 'open sheet re-renders in English without reload');
    await closeSheet(d);
    await click(label(d, 'Menu')); const labels = items(d).map(i => i.textContent.trim()); await click(label(d, 'Menu'));
    assert.deepEqual(labels, ['Invite to Rolff', 'Notifications', 'Account (email and password)', 'Plan', 'Privacy and deletion', 'App language', 'FAQ', 'Contact', 'Privacy policy', 'Log out'], labels.join(', '));
    assert.equal(await inviteLang('Invite to Rolff', /Send|Invite/), 'en');
  } finally { await f.close(); }
});

test('Kontakt: only Feedback / Problemer med Rolff-appen, fixed-size box with 2000 limit and counter', async () => {
  const f = await env(); const { w, d } = f; try {
    const s = await openItem(d, 'Kontakt');
    assert.equal(s.getAttribute('aria-label'), 'Kontakt');
    assert.match(s.textContent, /kundeservice/);
    assert.deepEqual([...s.querySelectorAll('#fc option')].map(o => [o.value, o.textContent]), [['feedback', 'Feedback'], ['app_problem', 'Problemer med Rolff-appen']]);
    const ta = s.querySelector('#fb'); assert.equal(ta.maxLength, 2000); assert.ok(ta.classList.contains('feedback-text'));
    assert.equal(s.querySelector('#fb-count').textContent, '0/2000'); assert.equal(ta.getAttribute('aria-describedby'), 'fb-count');
    const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, 'Hej æøå'); ta.dispatchEvent(new w.Event('input', { bubbles: true })); await delay(20);
    assert.equal(s.querySelector('#fb-count').textContent, '7/2000');
    assert.ok(!/kaldenavn/.test(s.textContent));
  } finally { await f.close(); }
});

test('Privatliv og sletning: equal headings, themed checkboxes, no account-delete card', async () => {
  const f = await env(); const { d } = f; try {
    const s = await openItem(d, 'Privatliv og sletning'); await delay(60);
    const heads = [...s.querySelectorAll('.privacy h3')];
    assert.deepEqual(heads.map(h => h.textContent), ['Opbevaring og synkronisering', 'Download mine data']);
    assert.ok(!/Automatisk sletning ved inaktivitet/.test(s.textContent));
    assert.ok(heads.every(h => h.classList.contains('psec-h')));
    assert.equal(s.querySelector('.danger-card'), null, 'delete moved to Konto');
    assert.ok(!s.querySelector('#delpw') && !s.querySelector('button.danger'));
    assert.equal(s.querySelectorAll('input[type=checkbox]').length, 1); assert.ok([...s.querySelectorAll('input[type=checkbox]')].every(c => c.classList.contains('check') && c.closest('label.check-row')));
    assert.match(s.textContent, /Hent en kopi af dine data/);
  } finally { await f.close(); }
});

test('Konto: delete lives in a danger card with export warning and the long action label', async () => {
  const f = await env(); const { d } = f; try {
    const s = await openItem(d, 'Konto (e-mail og adgangskode)'); await delay(60);
    assert.equal(s.getAttribute('aria-label'), 'Konto');
    const card = s.querySelector('.danger-card'); assert.ok(card, 'danger card');
    assert.equal(card.querySelector('h3').textContent, 'Slet konto');
    assert.ok(card.querySelector('#delpw') && card.querySelector('input.check') && card.querySelector('button.danger'));
    assert.equal(card.querySelector('button.danger').textContent, 'Slet konto, slet alle data og opsig abonnement');
    assert.match(card.textContent, /alle data i appen/);
    assert.match(card.textContent, /udskrift/);
    assert.match(card.textContent, /med det samme/);
    assert.match(card.textContent, /ikke kun en deaktivering/);
    assert.match(card.textContent, /App Store eller Google Play/);
    assert.match(card.textContent, /apps\.apple\.com\/account\/subscriptions/);
    assert.match(card.textContent, /resterende periode/);
    assert.match(card.textContent, /refusion/);
    assert.match(card.textContent, /Opsig abonnement/);

    assert.match(card.textContent, /Eksportér samtale/);
    assert.ok(![...card.querySelectorAll('button')].some(b => /Hent mine data først|Download my data first/.test(b.textContent)));
    assert.ok(card.querySelector('#delexport'), 'transcript checkbox remains');
    assert.match(card.querySelector('label[for="delexport"], #delexport') ? card.querySelector('#delexport').closest('label').textContent : '', /fuld udskrift/);
    await closeSheet(d);
    const priv = await openItem(d, 'Privatliv og sletning');
    assert.match(priv.textContent, /Download mine data/);
  } finally { await f.close(); }
});

test('front page: visible "Invitér til Rolff" button above the list opens the same top invite sheet', async () => {
  const f = await env(); const { d } = f; try {
    const head = d.querySelector('.convlist-head'); assert.ok(head, 'list header');
    assert.ok(!head.querySelector('h2'), 'no visible Samtaler heading in the row'); assert.ok(d.querySelector('#convlist-title.sr-only'), 'list keeps an accessible name');
    const web = head.querySelector('button.webapp-btn'); assert.ok(web, 'Download webapp pill'); assert.equal(web.textContent.trim(), 'Download webapp'); assert.ok(web.getAttribute('aria-label'));
    assert.ok(web.compareDocumentPosition(head.querySelector('button.invite-btn:not(.webapp-btn)')) & 4, 'webapp pill left of Invitér til Rolff');
    const btn = head.querySelector('button.invite-btn:not(.webapp-btn)'); assert.ok(btn); assert.equal(btn.textContent.trim(), 'Invitér til Rolff');
    assert.ok(btn.compareDocumentPosition(d.querySelector('.convitems')) & 4, 'button is before the list');
    assert.equal(btn.querySelector('svg').getAttribute('aria-hidden'), 'true');
    await click(btn); await delay(60);
    const s = d.querySelector('.sheet'); assert.equal(s.getAttribute('aria-label'), 'Invitér til Rolff'); assert.ok(s.classList.contains('anchored-card'));
    assert.ok(!/De andre i samtalen ser din e-mail/.test(s.textContent), 'email fact is no longer on the invite card');
    assert.equal(s.querySelectorAll('ul.invite-points').length, 0, 'invite facts moved to FAQ');
    assert.equal(s.querySelector('#ie').getAttribute('placeholder'), 'navn@eksempel.dk');
    assert.ok(!/Mit visningsnavn|indtil du vælger/.test(s.textContent));
    await closeSheet(d);
    await click(label(d, 'Menu')); assert.ok(items(d).some(i => i.textContent.trim() === 'Invitér til Rolff'), 'menu entry kept'); await click(label(d, 'Menu'));
  } finally { await f.close(); }
});

test('Konto: Opsig abonnement is visible on a paid plan and confirms with a warning card', async () => {
  const f = await env(); const { d, w } = f; try {
    const s = await openItem(d, 'Konto (e-mail og adgangskode)'); await delay(80);
    const cancel = [...s.querySelectorAll('button')].find(b => b.textContent.trim() === 'Opsig abonnement');
    assert.ok(cancel, 'Opsig abonnement on Konto');
    await click(cancel); await delay(60);
    const card = d.querySelector('.confirm-card'); assert.ok(card);
    assert.equal(card.querySelector('#confirm-title, [id=confirm-title], h2, h3')?.textContent || card.querySelector('.sheethead h2, .card-title, h2')?.textContent, 'Opsig abonnement?');
    assert.match(card.textContent, /Konto og data bliver/);
    assert.match(card.textContent, /9\. december 2026|periodens slut/);
    assert.match(card.textContent, /Genoptag abonnement/);
    const x = card.querySelector('[aria-label="Luk"]'); assert.ok(x, 'X-only close');
    assert.ok(![...card.querySelectorAll('button')].some(b => /Annuller/.test(b.textContent)));
    const ok = [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Opsig abonnement');
    assert.ok(ok); await click(ok); await delay(80);
    assert.ok(w.QA.calls.some(c => c.name === 'cancel_my_subscription'));
    assert.match(d.body.textContent, /Dit abonnement udløber 9\. december 2026/);
    const resume = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Genoptag abonnement');
    assert.ok(resume, 'undo after cancel');
  } finally { await f.close(); }
});

test('Privatliv: on Premium sky-synk can be turned on; no inactivity section', async () => {
  const f = await env(); const { d } = f; try {
    const s = await openItem(d, 'Privatliv og sletning'); await delay(80);
    const sync = [...s.querySelectorAll('label, .check-row')].find(el => /Sky-synk \(brug Rolff på flere enheder\)/.test(el.textContent));
    assert.ok(sync, 'sync row');
    const box = sync.querySelector('input[type=checkbox]');
    assert.equal(box.disabled, false);
    assert.ok(!s.querySelector('.sync-premium-note'));
    assert.ok(!/Kun Premium/.test(s.textContent));
    assert.ok(!/Automatisk sletning ved inaktivitet/.test(s.textContent));
    assert.ok(!/Slet min konto, hvis jeg ikke logger ind/.test(s.textContent));
  } finally { await f.close(); }
});

test('Privatliv: on Standard sky-synk is locked with Kun Premium and opens Abonnement', async () => {
  const f = await env(); const { d, w } = f; try {
    w.QA.setCurrentPlan('text');
    const s = await openItem(d, 'Privatliv og sletning'); await delay(80);
    const sync = [...s.querySelectorAll('label, .check-row')].find(el => /Sky-synk \(brug Rolff på flere enheder\)/.test(el.textContent));
    assert.ok(sync, 'sync row');
    const box = sync.querySelector('input[type=checkbox]');
    assert.equal(box.disabled, true);
    assert.equal(box.checked, false);
    assert.match(s.textContent, /Kun Premium/);
    const up = [...s.querySelectorAll('button')].find(b => b.textContent.trim() === 'Opgradér til Premium');
    assert.ok(up); await click(up); await delay(80);
    assert.ok(d.querySelector('.plans'), 'Abonnement sheet opened');
  } finally { await f.close(); }
});
