// SQL integration tests for the Rolff schema, run in PGlite (real Postgres in WASM)
// with a minimal Supabase auth stub. Usage: node run.mjs
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions;
  create table auth.users(id uuid primary key default gen_random_uuid(), email varchar(255), raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
  grant usage on schema auth, public, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
const mig = fs.readdirSync('../../supabase/migrations').sort();
for (const f of mig) await db.exec(fs.readFileSync('../../supabase/migrations/' + f, 'utf8'));

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, '-', e.message); } }
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.sub', '${uid}', true);`);
    return (await tx.query(sql, params)).rows;
  });
}
async function svc(sql, params = []) {
  return db.transaction(async (tx) => { await tx.exec(`set local role service_role;`); return (await tx.query(sql, params)).rows; });
}
async function rejects(p, re) { await assert.rejects(p, re); }
const hash = async (s) => (await db.query(`select encode(extensions.digest($1,'sha256'),'hex') h`, [s])).rows[0].h;

const [A, B, X, C] = (await db.query(`insert into auth.users(raw_user_meta_data) values ('{"display_name":"Test A"}'),('{"display_name":"Test B"}'),('{"display_name":"Uvedkommende"}'),('{"display_name":"Raadgiver"}') returning id`)).rows.map(r => r.id);

let conv, token;
await t('A opretter samtale', async () => { conv = (await as(A, `select create_conversation('Test') c`))[0].c; assert.ok(conv); });
await t('A opretter invitation (kun hash gemt)', async () => {
  token = (await as(A, `select * from create_invitation($1,'parent')`, [conv]))[0].token;
  const r = await db.query(`select count(*)::int n from invitations where token_hash = extensions.digest($1,'sha256')`, [token]);
  assert.equal(r.rows[0].n, 1);
});
await t('Forkert token giver generisk fejl', async () => rejects(as(B, `select accept_invitation('deadbeef')`), /invalid_invitation/));
await t('B accepterer invitation', async () => { const r = await as(B, `select accept_invitation($1) c`, [token]); assert.equal(r[0].c, conv); });
await t('Invitation kan ikke genbruges', async () => rejects(as(X, `select accept_invitation($1)`, [token]), /invalid_invitation/));
await t('Uvedkommende kan ikke læse beskeder', async () => rejects(as(X, `select * from get_messages($1)`, [conv]), /not_member/));
await t('Uvedkommende ser ingen samtaler', async () => assert.equal((await as(X, `select * from conversations`)).length, 0));
await t('Klient kan ikke læse messages-tabellen direkte', async () => rejects(as(A, `select * from messages`), /permission denied/));
await t('Klient kan ikke kalde commit_message', async () => rejects(as(A, `select commit_message(gen_random_uuid(),$1,$2,'hej','key-12345')`, [A, conv]), /permission denied/));
await t('Klient kan ikke udstede godkendelse', async () => rejects(as(A, `select issue_approval($1,$2,'x','p','m')`, [A, conv]), /permission denied/));

const body = 'Kan du hente kl. 16 i stedet for 15?';
let appr;
await t('prepare_send ok for medlem', async () => { await svc(`select * from prepare_send($1,$2,$3)`, [A, conv, body]); });
await t('prepare_send afviser uvedkommende', async () => rejects(svc(`select * from prepare_send($1,$2,$3)`, [X, conv, body]), /not_member/));
await t('prepare_send afviser >480 tegn', async () => rejects(svc(`select * from prepare_send($1,$2,$3)`, [A, conv, 'x'.repeat(481)]), /length/));
await t('Ændret tekst med gammel hash afvises', async () => {
  appr = (await svc(`select issue_approval($1,$2,$3,'test','m') id`, [A, conv, await hash(body)]))[0].id;
  await rejects(svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa1')`, [appr, A, conv, body + ' Idiot.']), /approval_invalid/);
});
await t('Godkendelse kan ikke bruges af anden afsender', async () => rejects(svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa2')`, [appr, B, conv, body]), /approval_invalid/));
let mid;
await t('Gyldig godkendelse gemmer besked', async () => { const r = await svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa3')`, [appr, A, conv, body]); mid = r[0].message_id; assert.equal(r[0].duplicate, false); });
await t('Netværksretry (samme nøgle) giver ingen dublet', async () => { const r = await svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa3')`, [appr, A, conv, body]); assert.equal(r[0].message_id, mid); assert.equal(r[0].duplicate, true); });
await t('Godkendelse kan ikke genbruges med ny nøgle', async () => rejects(svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa4')`, [appr, A, conv, body]), /approval_invalid/));
await t('Udløbet godkendelse afvises', async () => {
  const id = (await svc(`select issue_approval($1,$2,$3,'test','m') id`, [A, conv, await hash('hej')]))[0].id;
  await db.query(`update moderation_approvals set expires_at = now() - interval '1 second' where id=$1`, [id]);
  await rejects(svc(`select * from commit_message($1,$2,$3,'hej','key-aaaaaaa5')`, [id, A, conv]), /approval_invalid/);
});
await t('B (ingen modtagetider) modtager beskeden', async () => { const r = await as(B, `select * from get_messages($1)`, [conv]); assert.equal(r.length, 1); assert.equal(r[0].body, body); });
await t('Svar indeholder ingen kvitterings-/statusfelter', async () => {
  const r = await as(A, `select * from get_messages($1)`, [conv]);
  assert.deepEqual(Object.keys(r[0]).sort(), ['body', 'created_at', 'id', 'mine', 'sender_id', 'sender_name']);
});

// Receive windows
const sendAs = async (from, text, key) => { const id = (await svc(`select issue_approval($1,$2,$3,'test','m') id`, [from, conv, await hash(text)]))[0].id; return svc(`select * from commit_message($1,$2,$3,$4,$5)`, [id, from, conv, text, key]); };
await t('Modtagetid: besked uden for vindue holdes tilbage', async () => {
  // B only receives in a 1-minute window that is never "now": choose a weekday != today
  await db.query(`insert into receive_settings(user_id,timezone,enabled) values ($1,'Europe/Copenhagen',true)`, [B]);
  const dow = (await db.query(`select extract(isodow from now() at time zone 'Europe/Copenhagen')::int d`)).rows[0].d;
  await db.query(`insert into receive_windows(user_id,weekday,start_minute,end_minute) values ($1,$2,600,601)`, [B, dow === 1 ? 3 : 1]);
  await sendAs(A, 'Afleveringen var 40 minutter forsinket. Giv venligst besked næste gang.', 'key-bbbbbbb1');
  const r = await as(B, `select * from get_messages($1)`, [conv]);
  assert.equal(r.length, 1);
  assert.equal((await as(B, `select my_pending_count() n`))[0].n, 1);
});
await t('Afsender kan ikke se om modtageren har fået beskeden', async () => { const r = await as(A, `select * from get_messages($1)`, [conv]); assert.ok(r.every(m => !('released_at' in m))); });
await t('Modtag nu frigiver ventende beskeder', async () => { assert.equal((await as(B, `select receive_now() n`))[0].n, 1); assert.equal((await as(B, `select * from get_messages($1)`, [conv])).length, 2); });
await t('Indholdsløst notifikationsjob oprettet', async () => { const r = await db.query(`select * from notification_jobs where user_id=$1`, [B]); assert.ok(r.rows.length >= 1); assert.deepEqual(Object.keys(r.rows[0]).sort(), ['attempts', 'created_at', 'id', 'sent_at', 'user_id']); });
await t('Vindue over midnat + sommertid (DST) beregnes korrekt', async () => {
  await db.query(`delete from receive_windows where user_id=$1`, [B]);
  // Saturday 22:00 -> 07:00 (overnight)
  await db.query(`insert into receive_windows(user_id,weekday,start_minute,end_minute) values ($1,6,1320,420)`, [B]);
  const q = async (ts) => (await db.query(`select in_receive_window($1,$2::timestamptz) v`, [B, ts])).rows[0].v;
  // 2026-10-24 is a Saturday (CEST, UTC+2). 2026-10-25 03:00 CEST -> 02:00 CET (DST ends).
  assert.equal(await q('2026-10-24T20:30:00Z'), true);   // Sat 22:30 CEST
  assert.equal(await q('2026-10-24T19:30:00Z'), false);  // Sat 21:30 CEST
  assert.equal(await q('2026-10-25T05:30:00Z'), true);   // Sun 06:30 CET (after DST change)
  assert.equal(await q('2026-10-25T06:30:00Z'), false);  // Sun 07:30 CET
  assert.equal(await q('2026-10-25T21:30:00Z'), false);  // Sun 22:30 – no Sunday window
});

// Extra members & consent
await t('Ekstra medlem uden fuldt samtykke afvises', async () => {
  const tk = (await as(A, `select * from create_invitation($1,'reader')`, [conv]))[0].token;
  await rejects(as(C, `select accept_invitation($1)`, [tk]), /consent_missing/);
  globalThis.tkC = tk;
});
await t('Samtykke til læser genbruges ikke til anden rolle', async () => {
  const r = (await as(A, `select * from create_invitation($1,'writer')`, [conv]))[0];
  const inv = (await as(B, `select * from list_pending_invitations($1)`, [conv]));
  assert.ok(inv.length >= 2);
  // B consents only to the reader invitation
  const readerInv = (await db.query(`select id from invitations where token_hash=extensions.digest($1,'sha256')`, [globalThis.tkC])).rows[0].id;
  await as(B, `select consent_invitation($1)`, [readerInv]);
  await rejects(as(X, `select accept_invitation($1)`, [r.token]), /consent_missing/);
});
await t('Med enstemmigt samtykke kan læser tilslutte sig', async () => { const r = await as(C, `select accept_invitation($1) c`, [globalThis.tkC]); assert.equal(r[0].c, conv); });
await t('Nyt medlem ser ingen tidligere historik', async () => assert.equal((await as(C, `select * from get_messages($1)`, [conv])).length, 0));
await t('Gamle samtykker gælder ikke efter medlemsændring', async () => {
  // writer invitation was created at old member_version -> now stale
  const any = (await db.query(`select id from invitations where role='writer'`)).rows[0].id;
  await rejects(as(B, `select consent_invitation($1)`, [any]), /stale_invitation/);
});
await t('Læser kan ikke sende (heller ikke via server-API)', async () => rejects(svc(`select * from prepare_send($1,$2,'hej')`, [C, conv]), /read_only/));
await t('Læser kan ikke committe selv med godkendelse', async () => {
  const id = (await svc(`select issue_approval($1,$2,$3,'test','m') id`, [C, conv, await hash('hej')]))[0].id;
  await rejects(svc(`select * from commit_message($1,$2,$3,'hej','key-ccccccc1')`, [id, C, conv]), /not_member/);
});
await t('Tilbagekaldt invitation virker ikke', async () => {
  const conv2 = (await as(A, `select create_conversation('T2') c`))[0].c;
  const r = (await as(A, `select * from create_invitation($1,'parent')`, [conv2]))[0];
  await as(A, `select revoke_invitation($1)`, [r.invitation_id]);
  await rejects(as(X, `select accept_invitation($1)`, [r.token]), /invalid_invitation/);
});
await t('Udløbet invitation virker ikke', async () => {
  const conv3 = (await as(A, `select create_conversation('T3') c`))[0].c;
  const r = (await as(A, `select * from create_invitation($1,'parent')`, [conv3]))[0];
  await db.query(`update invitations set expires_at = now() - interval '1 second' where id=$1`, [r.invitation_id]);
  await rejects(as(X, `select accept_invitation($1)`, [r.token]), /invalid_invitation/);
});
await t('Rate limit efter 10 forsøg/minut', async () => {
  for (let i = 0; i < 10; i++) await svc(`select record_attempt($1,$2,'allow',null)`, [A, conv]);
  await rejects(svc(`select * from prepare_send($1,$2,'hej')`, [A, conv]), /rate_limited/);
});
// E-mail invitations
await db.query(`update auth.users set email='a@test.invalid' where id=$1`, [A]);
await db.query(`update auth.users set email='maya@test.invalid' where id=$1`, [X]);
let em;
await t('E-mailinvitation opretter ny samtale med kun inviterende', async () => {
  em = (await as(A, `select * from create_email_invitation('Maya@Test.invalid')`))[0];
  assert.equal((await db.query(`select count(*)::int n from memberships where conversation_id=$1`, [em.conversation_id])).rows[0].n, 1);
});
await t('Peek virker anonymt med gyldigt token, intet med ugyldigt', async () => {
  const ok = await db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select * from peek_invitation($1)`, [em.token])).rows; });
  assert.equal(ok[0].invitee_email, 'maya@test.invalid');
  const no = await db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select * from peek_invitation('x')`)).rows; });
  assert.equal(no.length, 0);
});
await t('Ikke-inviteret konto kan ikke acceptere', async () => rejects(as(B, `select accept_invitation($1)`, [em.token]), /invalid_invitation/));
await t('Inviteret konto accepterer', async () => assert.equal((await as(X, `select accept_invitation($1) c`, [em.token]))[0].c, em.conversation_id));
await t('Link er engangs', async () => rejects(as(X, `select accept_invitation($1)`, [em.token]), /invalid_invitation/));
await t('Kan ikke invitere sig selv', async () => rejects(as(A, `select * from create_email_invitation('a@test.invalid')`), /bad_email/));
// Private aliases
const others = async (u, cid) => (await as(u, `select others from list_my_conversations() where id=$1`, [cid]))[0].others;
await t('Invitation har ingen modtagernavn', async () => {
  assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name='invitations' and column_name='invitee_name'`)).rows[0].n, 0);
  const p = await db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select * from peek_invitation('x')`)).fields.map(f => f.name).sort(); });
  assert.deepEqual(p, ['expires_at', 'invitee_email', 'inviter_email']);
});
await t('Modpart vises som e-mail som standard', async () => { const o = await others(A, em.conversation_id); assert.equal(o[0].email, 'maya@test.invalid'); assert.equal(o[0].alias, null); });
await t('Kaldenavn er privat for ejeren', async () => {
  await as(A, `select set_contact_alias($1,'Skat')`, [X]);
  assert.equal((await others(A, em.conversation_id))[0].alias, 'Skat');
  const ox = await others(X, em.conversation_id); assert.equal(ox[0].email, 'a@test.invalid'); assert.equal(ox[0].alias, null);
  assert.equal((await as(X, `select count(*)::int n from contact_aliases`))[0].n, 0);
  assert.equal((await as(A, `select count(*)::int n from contact_aliases`))[0].n, 1);
});
await t('Direkte skrivning i alias-tabellen afvises', async () => rejects(as(X, `insert into contact_aliases values ($1,$2,'x')`, [X, A]), /permission|denied/));
await t('Kan ikke give kaldenavn til fremmed', async () => rejects(as(X, `select set_contact_alias($1,'x')`, [C]), /not_found/));
await t('Tomt kaldenavn nulstiller til e-mail', async () => { await as(A, `select set_contact_alias($1,'  ')`, [X]); assert.equal((await others(A, em.conversation_id))[0].alias, null); });
await t('Beskeder viser e-mail som afsendernavn', async () => {
  const r = await as(B, `select sender_name from get_messages($1) where not mine`, [conv]);
  assert.ok(r.length > 0); for (const x of r) assert.equal(x.sender_name, 'a@test.invalid');
});
// Isolation: a third user (C) cannot read, send or add themselves
await t('Tredjeperson kan ikke læse beskeder', async () => rejects(as(C, `select * from get_messages($1)`, [em.conversation_id]), /not_member/));
await t('Tredjeperson ser ingen tabeldata', async () => {
  for (const tb of ['messages', 'invitations', 'message_deliveries'])
    try { assert.equal((await as(C, `select count(*)::int n from ${tb}`))[0].n, 0); } catch (e) { assert.match(String(e), /permission|denied/); }
  assert.equal((await as(C, `select count(*)::int n from memberships where conversation_id=$1`, [em.conversation_id]))[0].n, 0);
  assert.equal((await as(C, `select count(*)::int n from conversations where id=$1`, [em.conversation_id]))[0].n, 0);
});
await t('Tredjeperson kan ikke tilføje sig selv', async () => rejects(as(C, `insert into memberships(conversation_id,user_id,role) values ($1,$2,'parent')`, [em.conversation_id, C]), /permission|denied|policy/));
await t('Tredjeperson kan ikke sende (server afviser)', async () => rejects(svc(`select * from prepare_send($1,$2,'hej')`, [C, em.conversation_id]), /not_member/));
await t('Klient kan ikke kalde send-pipelinen direkte', async () => rejects(as(C, `select * from prepare_send($1,$2,'hej')`, [C, em.conversation_id]), /permission|denied/));
await t('Tredjeperson ser ikke samtalen i listen', async () => assert.equal((await as(C, `select count(*)::int n from list_my_conversations() where id=$1`, [em.conversation_id]))[0].n, 0));
await t('Ingen brugersøgning: profiler og auth er lukket', async () => {
  assert.equal((await as(C, `select count(*)::int n from profiles where user_id <> $1`, [C]))[0].n, 0);
  await rejects(as(C, `select count(*) from auth.users`), /permission|denied/);
});
await t('To første medlemmer kan skrive med det samme efter accept', async () => {
  const r = await svc(`select * from prepare_send($1,$2,'hej')`, [X, em.conversation_id]); assert.ok(Array.isArray(r));
});
// Private colour
await t('Farve er privat pr. bruger', async () => {
  await as(A, `select set_conversation_color($1,'rose')`, [em.conversation_id]);
  assert.equal((await as(A, `select color from list_my_conversations() where id=$1`, [em.conversation_id]))[0].color, 'rose');
  assert.equal((await as(X, `select color from list_my_conversations() where id=$1`, [em.conversation_id]))[0].color, null);
  assert.equal((await as(X, `select count(*)::int n from conversation_prefs`))[0].n, 0);
});
await t('Ugyldig farve afvises', async () => rejects(as(A, `select set_conversation_color($1,'#fff')`, [em.conversation_id]), /check|violat/));
await t('Ikke-medlem kan ikke sætte farve', async () => rejects(as(C, `select set_conversation_color($1,'red')`, [em.conversation_id]), /not_member/));
await t('Titel returneres ikke længere', async () => assert.equal('title' in (await as(A, `select * from list_my_conversations() limit 1`))[0], false));

// Extra members (reader/writer) by e-mail with unanimous consent
const [L, W, D] = (await db.query(`insert into auth.users(email) values ('advokat@test.invalid'),('raadgiver@test.invalid'),('afvist@test.invalid') returning id`)).rows.map(r => r.id);
const ec = em.conversation_id;
await sendAs(A, 'Besked fra før advokaten kom med', 'pre-extra-1');
let li;
await t('Forælder inviterer læser; kræver modpartens godkendelse', async () => {
  li = (await as(A, `select * from create_member_invitation($1,'advokat@test.invalid','reader')`, [ec]))[0];
  assert.equal(li.complete, false); assert.equal(li.token, null);
  const p = (await as(X, `select * from list_pending_invitations($1)`, [ec]))[0];
  assert.equal(p.invitee_email, 'advokat@test.invalid'); assert.equal(p.consents, 1); assert.equal(p.required, 2); assert.equal(p.i_consented, false);
  assert.deepEqual((await svc(`select email from pending_approver_emails($1)`, [li.invitation_id])).map(r => r.email), ['maya@test.invalid']);
});
await t('Ikke-godkendt person ser intet og kan ikke komme ind', async () => {
  await rejects(as(L, `select * from get_messages($1)`, [ec]), /not_member/);
  assert.equal((await as(L, `select count(*)::int n from list_pending_invitations($1)`, [ec]))[0].n, 0);
  assert.equal((await as(L, `select count(*)::int n from list_my_conversations()`))[0].n, 0);
  await rejects(as(L, `select consent_member_invitation($1)`, [li.invitation_id]), /not_found/);
});
await t('Tredjepart kan ikke invitere eller godkende sig selv', async () => {
  await rejects(as(C, `select * from create_member_invitation($1,'x@test.invalid','reader')`, [ec]), /forbidden/);
  await rejects(as(C, `select consent_member_invitation($1)`, [li.invitation_id]), /not_found/);
  await rejects(as(C, `insert into invitation_consents values ($1,$2,1,'reader')`, [li.invitation_id, C]), /permission|denied|policy/);
  await rejects(as(C, `select pending_approver_emails($1)`, [li.invitation_id]), /permission|denied/);
});
await t('Kun skrive/læse-roller kan inviteres som ekstra', async () => rejects(as(A, `select * from create_member_invitation($1,'y@test.invalid','parent')`, [ec]), /bad_role/));
let tok;
await t('Enstemmig godkendelse udsteder token; læser kommer ind', async () => {
  const r = (await as(X, `select * from consent_member_invitation($1)`, [li.invitation_id]))[0];
  assert.equal(r.complete, true); assert.match(r.token, /^[0-9a-f]{48}$/); assert.equal(r.invitee_email, 'advokat@test.invalid'); tok = r.token;
  await rejects(as(C, `select accept_invitation($1)`, [tok]), /invalid_invitation/);
  await as(L, `select accept_invitation($1)`, [tok]);
});
await t('Ny deltager ser ingen historik fra før', async () => assert.equal((await as(L, `select count(*)::int n from get_messages($1)`, [ec]))[0].n, 0));
await t('Læser kan aldrig skrive (server)', async () => {
  await rejects(svc(`select * from prepare_send($1,$2,'hej')`, [L, ec]), /read_only/);
  await rejects(as(L, `insert into messages(conversation_id,sender_id,body) values ($1,$2,'hej')`, [ec, L]), /permission|denied|policy/);
});
await t('Læser ser nye beskeder', async () => { await sendAs(A, 'Ny besked efter advokaten', 'post-extra-1'); const r = await as(L, `select body from get_messages($1)`, [ec]); assert.ok(r.every(x => x.body !== 'Besked fra før advokaten kom med')); });
await t('Nu kræves også læserens godkendelse; ét afslag stopper', async () => {
  const w = (await as(A, `select * from create_member_invitation($1,'afvist@test.invalid','writer')`, [ec]))[0];
  await as(X, `select * from consent_member_invitation($1)`, [w.invitation_id]);
  assert.equal((await as(A, `select required from list_pending_invitations($1)`, [ec]))[0].required, 3);
  await as(L, `select decline_invitation($1)`, [w.invitation_id]);
  assert.equal((await as(A, `select count(*)::int n from list_pending_invitations($1)`, [ec]))[0].n, 0);
  await rejects(as(L, `select * from consent_member_invitation($1)`, [w.invitation_id]), /not_found/);
});
await t('Skriver kan skrive efter enstemmig godkendelse', async () => {
  const w = (await as(A, `select * from create_member_invitation($1,'raadgiver@test.invalid','writer')`, [ec]))[0];
  await as(X, `select * from consent_member_invitation($1)`, [w.invitation_id]);
  const r = (await as(L, `select * from consent_member_invitation($1)`, [w.invitation_id]))[0];
  await as(W, `select accept_invitation($1)`, [r.token]);
  assert.ok(Array.isArray(await svc(`select * from prepare_send($1,$2,'hej')`, [W, ec])));
});
await t('Læser kan ikke invitere', async () => rejects(as(L, `select * from create_member_invitation($1,'z@test.invalid','reader')`, [ec]), /forbidden/));
// Feedback
await t('Feedback: kan indsende egen, ingen kan læse', async () => {
  await as(A, `select submit_feedback('idea','Mere kontrast')`);
  await rejects(as(A, `select * from feedback`), /permission|denied/);
  await rejects(as(C, `select * from feedback`), /permission|denied/);
  assert.equal((await svc(`select count(*)::int n from feedback where user_id=$1`, [A]))[0].n, 1);
});
await t('Feedback: direkte indsættelse afvises', async () => rejects(as(A, `insert into feedback(user_id, body) values ($1,'x')`, [B]), /permission|denied|policy/));
await t('Feedback: ugyldig kategori afvises', async () => rejects(as(A, `select submit_feedback('spam','x')`), /check|violat/));
await t('Feedback: for lang tekst afvises', async () => rejects(as(A, `select submit_feedback('other',repeat('x',2001))`), /check|violat/));
await t('Feedback: max 5 pr. døgn', async () => { for (let k = 0; k < 4; k++) await as(A, `select submit_feedback('other','ok')`); await rejects(as(A, `select submit_feedback('other','sjette')`), /rate_limited/); });
await t('Feedback: anonym kan ikke indsende', async () => rejects(db.transaction(async (tx) => { await tx.exec(`set local role anon`); return tx.query(`select submit_feedback('other','x')`); }), /permission|denied/));

// GDPR: deletion (art. 17) and inactivity
const [P, Q, R] = (await db.query(`insert into auth.users(email) values ('p@test.invalid'),('q@test.invalid'),('r@test.invalid') returning id`)).rows.map(r => r.id);
let pc, solo;
await t('Sletning: opsætning (P og Q i samtale, P alene i en anden)', async () => {
  pc = (await as(P, `select create_conversation('x') c`))[0].c;
  const tk = (await as(P, `select * from create_invitation($1,'parent')`, [pc]))[0].token;
  await as(Q, `select accept_invitation($1)`, [tk]);
  solo = (await as(P, `select create_conversation('y') c`))[0].c;
  for (const [txt, k] of [['Leveret fra P', 'key-del00001']]) { const id = (await svc(`select issue_approval($1,$2,$3,'test','m') id`, [P, pc, await hash(txt)]))[0].id; await svc(`select * from commit_message($1,$2,$3,$4,$5)`, [id, P, pc, txt, k]); }
  await as(Q, `select * from get_messages($1)`, [pc]); // releases delivery
  // undelivered message: Q receives never
  await svc(`insert into receive_windows(user_id, weekday, start_min, end_min) select $1, (extract(isodow from now())::int % 7) + 1, 0, 1`, [Q]).catch(() => {});
  await as(P, `select set_conversation_color($1,'rose')`, [pc]);
  await as(P, `select set_contact_alias($1,'Q-alias')`, [Q]);
  await as(P, `select submit_feedback('idea','slet mig')`);
  await as(P, `select touch_seen()`);
});
await t('Klient kan ikke kalde purge_user_content / inactivity_sweep', async () => {
  await rejects(as(P, `select purge_user_content($1)`, [Q]), /permission denied/);
  await rejects(as(P, `select * from inactivity_sweep()`), /permission denied/);
});
let qBefore;
await t('Sletning: modparten har skrevet og modtaget før sletning', async () => {
  const id = (await svc(`select issue_approval($1,$2,$3,'test','m') id`, [Q, pc, await hash('Svar fra Q')]))[0].id;
  await svc(`select * from commit_message($1,$2,$3,'Svar fra Q','key-del00002')`, [id, Q, pc]);
  qBefore = await as(Q, `select * from get_messages($1)`, [pc]); assert.equal(qBefore.length, 2);
});
await t('Sletning: intet efterlades om brugeren', async () => {
  await svc(`select purge_user_content($1)`, [P]);
  await db.query(`delete from auth.users where id=$1`, [P]);
  const tabs = (await db.query(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
     where c.table_schema='public' and t.table_type='BASE TABLE' and c.data_type='uuid' and c.column_name ~ '(user_id|sender_id|created_by|owner_id|recipient_id|accepted_by|declined_by|contact_user_id)$'`)).rows;
  assert.ok(tabs.length >= 10);
  for (const r of tabs) { const n = (await db.query(`select count(*)::int n from public.${r.table_name} where ${r.column_name}=$1`, [P])).rows[0].n; assert.equal(n, 0, `${r.table_name}.${r.column_name}`); }
  assert.equal((await db.query(`select count(*)::int n from conversations where id=$1`, [solo])).rows[0].n, 0);
});
await t('Sletning: modpartens kopi er uændret (samme beskeder, tekst og tid; afsender "Slettet bruger")', async () => {
  const r = await as(Q, `select * from get_messages($1)`, [pc]);
  assert.deepEqual(r.map(x => [x.id, x.body, +x.created_at]), qBefore.map(x => [x.id, x.body, +x.created_at]));
  assert.equal(r.length, 2); assert.ok(r.some(x => x.mine)); const p = r.find(x => !x.mine); assert.equal(p.sender_name, 'Slettet bruger'); assert.equal(p.sender_id, null);
});
await t('Privatliv: standard 90 dage, til, ingen sky, 1 år', async () => {
  const r = (await as(Q, `select * from get_my_privacy()`))[0];
  assert.deepEqual(r, { inactivity_delete: true, inactivity_days: 90, cloud_sync: false, retention: '1y' });
});
await t('Privatliv: frist uden for 30-90 afvises', async () => rejects(as(Q, `select set_my_privacy(true, 10)`), /check|violat/));
await t('Privatliv: klient kan ikke læse user_privacy direkte', async () => rejects(as(Q, `select * from user_privacy`), /permission denied/));
await t('Inaktivitet: advarsel, så sletning efter frist; fravalg respekteres; login annullerer', async () => {
  await as(R, `select touch_seen()`);
  await as(Q, `select set_my_privacy(false, 30)`);
  await db.query(`update user_privacy set last_seen_at = now() - interval '100 days' where user_id = any($1)`, [[Q, R]]);
  let s = await svc(`select * from inactivity_sweep()`);
  assert.ok(s.some(x => x.user_id === R && x.action === 'warn')); assert.ok(!s.some(x => x.user_id === Q));
  s = await svc(`select * from inactivity_sweep()`); assert.ok(!s.some(x => x.user_id === R)); // warned once only
  await db.query(`update user_privacy set warned_at = now() - interval '15 days' where user_id=$1`, [R]);
  s = await svc(`select * from inactivity_sweep()`); assert.ok(s.some(x => x.user_id === R && x.action === 'delete'));
  await as(R, `select touch_seen()`);
  s = await svc(`select * from inactivity_sweep()`); assert.ok(!s.some(x => x.user_id === R));
});

// Blokerede ord + samtaleblokering
await t('Blokér ord: medlem tilføjer (normaliseret)', async () => { await as(A, `select add_blocked_word($1,'  Pis   Hoved ',true)`, [conv]); const r = await as(A, `select word from conversation_blocked_words`); assert.deepEqual(r.map(x => x.word), ['pis hoved']); });
await t('Blokér ord: uden bekræftelse tilføjes intet', async () => { await rejects(as(A, `select add_blocked_word($1,'test')`, [conv]), /ack_required/); await rejects(as(A, `select add_blocked_word($1,'test',false)`, [conv]), /ack_required/); assert.equal((await as(A, `select * from conversation_blocked_words where word='test'`)).length, 0); });
await t('Blokér ord: modparten kan ikke hente listen', async () => { assert.equal((await as(B, `select * from conversation_blocked_words`)).length, 0); await rejects(as(B, `select * from recipient_blocked_words($1,$2)`, [conv, B]), /permission denied/); });
await t('Blokér ord: uvedkommende ser intet og kan ikke tilføje', async () => { assert.equal((await as(X, `select * from conversation_blocked_words`)).length, 0); await rejects(as(X, `select add_blocked_word($1,'abc',true)`, [conv]), /not_member/); });
await t('Blokér ord: andre kan ikke slette ejerens ord', async () => { await as(B, `delete from conversation_blocked_words`); assert.equal((await svc(`select count(*)::int n from conversation_blocked_words where user_id=$1`, [A]))[0].n, 1); });
await t('Blokér ord: direkte insert afvises', async () => rejects(as(A, `insert into conversation_blocked_words(conversation_id,user_id,word) values ($1,$2,'xx')`, [conv, B]), /permission|denied/));
await t('Blokér ord: længde 2-40 og max 50', async () => { await rejects(as(A, `select add_blocked_word($1,'x',true)`, [conv]), /length/); await rejects(as(A, `select add_blocked_word($1,repeat('a',41),true)`, [conv]), /length/); for (let k = 0; k < 49; k++) await as(A, `select add_blocked_word($1,$2,true)`, [conv, 'ord' + k]); await rejects(as(A, `select add_blocked_word($1,'ord99',true)`, [conv]), /too_many/); await svc(`delete from conversation_blocked_words where word like 'ord%'`); });
await t('Blokér ord: server henter kun modtagernes ord (ikke afsenderens egne)', async () => { assert.deepEqual((await svc(`select * from recipient_blocked_words($1,$2) w`, [conv, B])).map(r => r.w), ['pis hoved']); assert.equal((await svc(`select * from recipient_blocked_words($1,$2)`, [conv, A])).length, 0); });
await t('Blokér ord: slettes ved kontosletning (cascade)', async () => { const [Z] = (await db.query(`insert into auth.users(email) values ('z@test.invalid') returning id`)).rows.map(r => r.id); const zc = (await as(Z, `select create_conversation('z') c`))[0].c; await as(Z, `select add_blocked_word($1,'hej',true)`, [zc]); await db.query(`delete from auth.users where id=$1`, [Z]); assert.equal((await svc(`select count(*)::int n from conversation_blocked_words where user_id=$1`, [Z]))[0].n, 0); });
await t('Blokering: B kan ikke sende, mens A blokerer (server)', async () => { await as(A, `select block_conversation($1)`, [conv]); await rejects(sendAs(B, 'Hej fra B', 'key-blk00001'), /cannot_deliver/); });
await t('Blokering: A (blokerende) kan stadig skrive', async () => { await sendAs(A, 'Hej fra A', 'key-blk00002'); });
await t('Blokering: B kan ikke se eller fjerne blokeringen', async () => { assert.equal((await as(B, `select * from conversation_blocks`)).length, 0); await as(B, `select unblock_conversation($1)`, [conv]); await rejects(sendAs(B, 'Hej igen', 'key-blk00003'), /cannot_deliver/); });
await t('Blokering: ingen udløbskolonne', async () => assert.deepEqual((await db.query(`select column_name from information_schema.columns where table_name='conversation_blocks' order by 1`)).rows.map(r => r.column_name), ['conversation_id', 'created_at', 'user_id']));
await t('Blokering: ophører kun når A afblokerer', async () => { await as(A, `select unblock_conversation($1)`, [conv]); await sendAs(B, 'Hej igen', 'key-blk00004'); });
await t('Feedback: nye kategorier', async () => { await svc(`delete from feedback`); await as(B, `select submit_feedback('complaint','x')`); await as(B, `select submit_feedback('filter','y')`); });

await t('Visningsnavn: standard er e-mail; kaldenavn skjuler e-mail i alle API-svar og slår igennem straks', async () => {
  await db.query(`update auth.users set email='a-login@test.invalid' where id=$1`, [A]);
  await svc(`delete from contact_aliases where owner_id=$1`, [B]);
  const lbl = async () => (await as(B, `select others from list_my_conversations() where id=$1`, [conv]))[0].others.find(o => o.user_id === A).email;
  assert.equal(await lbl(), 'a-login@test.invalid');
  await as(A, `select set_my_public_name('Mor')`);
  assert.equal(await lbl(), 'Mor');
  const all = JSON.stringify([await as(B, `select * from list_my_conversations()`), await as(B, `select * from get_messages($1)`, [conv])]);
  assert.ok(!all.includes('a-login@test.invalid'));
  assert.ok((await as(B, `select * from get_messages($1)`, [conv])).filter(m => m.sender_id === A).every(m => m.sender_name === 'Mor'));
  await rejects(as(B, `select * from profiles where user_id=$1`, [A]).then(r => { if (r.length) throw new Error('leak'); }).then(() => { throw new Error('ok-empty'); }), /ok-empty/);
  await rejects(as(B, `select public_label_of($1)`, [A]), /permission|denied/);
  await rejects(as(A, `select set_my_public_name('a@b')`), /bad_name/);
  await as(A, `select set_my_public_name(null)`); assert.equal(await lbl(), 'a-login@test.invalid');
});
await t('Rapport: B rapporterer med valgte beskeder; kun metadata gemmes', async () => {
  const ms = await as(B, `select id from get_messages($1)`, [conv]);
  const r = await as(B, `select * from submit_report($1,'harassment',$2::uuid[])`, [conv, [ms[0].id]]);
  assert.equal(r.length, 1); assert.ok(r[0].body);
  assert.deepEqual((await db.query(`select column_name from information_schema.columns where table_name='report_log' order by 1`)).rows.map(x => x.column_name), ['attached_count','category','conversation_id','created_at','id','user_id']);
  assert.equal((await svc(`select attached_count from report_log where user_id=$1`, [B]))[0].attached_count, 1);
});
await t('Rapport: ukendt kategori og fremmede besked-id afvises', async () => {
  await rejects(as(B, `select * from submit_report($1,'spam','{}')`, [conv]), /bad_input/);
  await rejects(as(B, `select * from submit_report($1,'other',$2::uuid[])`, [conv, ['00000000-0000-0000-0000-000000000001']]), /bad_messages/);
});
await t('Rapport: ikke-medlem afvises og kan ikke læse log', async () => { await rejects(as(X, `select * from submit_report($1,'other','{}')`, [conv]), /not_member/); await rejects(as(B, `select * from report_log`), /permission|denied/); });
await t('Rapport: rate limit 3/døgn', async () => { await as(B, `select * from submit_report($1,'other','{}')`, [conv]); await as(B, `select * from submit_report($1,'other','{}')`, [conv]); await rejects(as(B, `select * from submit_report($1,'other','{}')`, [conv]), /rate_limited/); });

await t('Opbevaring: standard 1 år; ugyldigt valg afvises', async () => {
  assert.equal((await as(A, `select * from get_my_privacy()`))[0].retention, '1y');
  await rejects(as(A, `select set_my_data_prefs(true,'10y')`), /bad_input/);
});
await t('Opbevaring: gamle beskeder skjules for 1 år, bevares fysisk hvis modparten valgte ubegrænset', async () => {
  const id = (await sendAs(B, 'Gammel besked', 'key-ret00001'))[0].message_id;
  await svc(`update messages set created_at = now() - interval '2 years' where id=$1`, [id]);
  await svc(`update memberships set joined_at = now() - interval '3 years' where conversation_id=$1`, [conv]);
  await as(A, `select set_my_data_prefs(false,'1y')`); await as(B, `select set_my_data_prefs(true,'unlimited')`);
  assert.ok(!(await as(A, `select id from get_messages($1)`, [conv])).some(m => m.id === id));
  assert.ok((await as(B, `select id from get_messages($1)`, [conv])).some(m => m.id === id));
  await svc(`select retention_sweep()`);
  assert.equal((await svc(`select count(*)::int n from messages where id=$1`, [id]))[0].n, 1);
  await as(B, `select set_my_data_prefs(false,'1y')`);
  await svc(`select retention_sweep()`);
  assert.equal((await svc(`select count(*)::int n from messages where id=$1`, [id]))[0].n, 0);
  await rejects(as(A, `select retention_sweep()`), /permission|denied/);
});

await t('Eksport: kun egne data, ingen andres aliaser/ord/feedback; rate limit', async () => {
  await svc(`insert into contact_aliases(owner_id,contact_user_id,alias) values ($1,$2,'HemmeligtAlias') on conflict do nothing`, [A, B]);
  await svc(`insert into conversation_blocked_words(conversation_id,user_id,word) values ($1,$2,'hemmeligtord') on conflict do nothing`, [conv, A]);
  await svc(`insert into feedback(user_id,category,body) values ($1,'other','AFeedbackTekst')`, [A]);
  const e = (await svc(`select export_user_data($1) e`, [B]))[0].e; const j = JSON.stringify(e);
  for (const leak of ['HemmeligtAlias', 'hemmeligtord', 'AFeedbackTekst']) assert.ok(!j.includes(leak), leak);
  assert.ok(e.account && e.memberships.length >= 1);
  const ea = JSON.stringify((await svc(`select export_user_data($1) e`, [A]))[0].e); assert.ok(ea.includes('HemmeligtAlias') && ea.includes('hemmeligtord'));
  await svc(`select export_user_data($1)`, [B]); await svc(`select export_user_data($1)`, [B]);
  await rejects(svc(`select export_user_data($1)`, [B]), /rate_limited/);
  await rejects(as(A, `select export_user_data($1)`, [A]), /permission|denied/);
});
await t('Auth-mail rate limit: 3 pr. time pr. adresse+type; kun service', async () => {
  const r = [];
  for (let i = 0; i < 4; i++) r.push((await svc(`select auth_mail_allow('h1','recovery') ok`))[0].ok);
  assert.deepEqual(r, [true, true, true, false]);
  assert.equal((await svc(`select auth_mail_allow('h1','email_change') ok`))[0].ok, true);
  await rejects(as(A, `select auth_mail_allow('h2','recovery')`), /permission|denied/);
});
console.log(`\n${pass} bestået, ${fail} fejlet`);
process.exit(fail ? 1 : 0);
