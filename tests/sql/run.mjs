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

await db.exec(`create function public.test_issue_current_approval(p_sender uuid,conv uuid,p_hash text,p_provider text,p_model text,p_reply uuid default null) returns uuid language sql security definer as $$
 select public.issue_reply_approval_v3(p_sender,conv,p_hash,p_provider,p_model,public.recipient_filter_snapshot(conv,p_sender)->>'revision',p_reply)
$$; revoke all on function public.test_issue_current_approval(uuid,uuid,text,text,text,uuid) from public,anon,authenticated; grant execute on function public.test_issue_current_approval(uuid,uuid,text,text,text,uuid) to service_role;`);
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

await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`, [A, B]);
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
await t('Klient kan ikke udstede godkendelse', async () => rejects(as(A, `select test_issue_current_approval($1,$2,'x','p','m')`, [A, conv]), /permission denied/));

const body = 'Kan du hente kl. 16 i stedet for 15?';
let appr;
await t('prepare_send ok for medlem', async () => { await svc(`select * from prepare_send($1,$2,$3)`, [A, conv, body]); });
await t('prepare_send afviser uvedkommende', async () => rejects(svc(`select * from prepare_send($1,$2,$3)`, [X, conv, body]), /not_member/));
await t('prepare_send afviser >480 tegn', async () => rejects(svc(`select * from prepare_send($1,$2,$3)`, [A, conv, 'x'.repeat(481)]), /length/));
await t('Ændret tekst med gammel hash afvises', async () => {
  appr = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [A, conv, await hash(body)]))[0].id;
  await rejects(svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa1')`, [appr, A, conv, body + ' Idiot.']), /approval_invalid/);
});
await t('Godkendelse kan ikke bruges af anden afsender', async () => rejects(svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa2')`, [appr, B, conv, body]), /approval_invalid/));
let mid;
await t('Gyldig godkendelse gemmer besked', async () => { const r = await svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa3')`, [appr, A, conv, body]); mid = r[0].message_id; assert.equal(r[0].duplicate, false); });
await t('Netværksretry (samme nøgle) giver ingen dublet', async () => { const r = await svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa3')`, [appr, A, conv, body]); assert.equal(r[0].message_id, mid); assert.equal(r[0].duplicate, true); });
await t('Godkendelse kan ikke genbruges med ny nøgle', async () => rejects(svc(`select * from commit_message($1,$2,$3,$4,'key-aaaaaaa4')`, [appr, A, conv, body]), /approval_invalid/));
await t('Udløbet godkendelse afvises', async () => {
  const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [A, conv, await hash('hej')]))[0].id;
  await db.query(`update moderation_approvals set expires_at = now() - interval '1 second' where id=$1`, [id]);
  await rejects(svc(`select * from commit_message($1,$2,$3,'hej','key-aaaaaaa5')`, [id, A, conv]), /approval_invalid/);
});
await t('B (ingen modtagetider) modtager beskeden', async () => { const r = await as(B, `select * from get_messages($1)`, [conv]); assert.equal(r.length, 1); assert.equal(r[0].body, body); });
await t('Svar indeholder ingen kvitterings-/statusfelter', async () => {
  const r = await as(A, `select * from get_messages($1)`, [conv]);
  assert.deepEqual(Object.keys(r[0]).sort(), ['att_alt', 'att_mime', 'att_name', 'att_pages', 'body', 'created_at', 'id', 'mine', 'sender_id', 'sender_name']);
});

// Receive windows
const sendAs = async (from, text, key) => { const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [from, conv, await hash(text)]))[0].id; return svc(`select * from commit_message($1,$2,$3,$4,$5)`, [id, from, conv, text, key]); };
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
await t('Gamle samtykker rækker ikke efter medlemsændring: nyt medlem skal også godkende', async () => {
  // writer invitation is carried over to the new member set; C (new) has not approved -> not complete
  const any = (await db.query(`select id from invitations where role='writer'`)).rows[0].id;
  const r = (await db.query(`select public._all_consented(i) ok, i.member_version = c.member_version same from invitations i join conversations c on c.id=i.conversation_id where i.id=$1`, [any])).rows[0];
  assert.equal(r.same, true); assert.equal(r.ok, false);
});
await t('Læser kan ikke sende (heller ikke via server-API)', async () => rejects(svc(`select * from prepare_send($1,$2,'hej')`, [C, conv]), /read_only/));
await t('Læser kan ikke committe selv med godkendelse', async () => {
  const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [C, conv, await hash('hej')]))[0].id;
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
await t('Ventende invitation viser invitee i listen (ikke anonym Venter…)', async () => {
  const row = (await as(A, `select others, pending_invitee from list_my_conversations() where id=$1`, [em.conversation_id]))[0];
  assert.deepEqual(row.others, []);
  assert.equal(row.pending_invitee, 'maya@test.invalid');
});
await t('Peek virker anonymt med gyldigt token, intet med ugyldigt', async () => {
  const ok = await db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select * from peek_invitation($1)`, [em.token])).rows; });
  assert.equal(ok[0].invitee_email, 'maya@test.invalid');
  const no = await db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select * from peek_invitation('x')`)).rows; });
  assert.equal(no.length, 0);
});
await t('Ikke-inviteret konto kan ikke acceptere', async () => rejects(as(B, `select accept_invitation($1)`, [em.token]), /invalid_invitation/));
await t('Inviteret konto accepterer', async () => assert.equal((await as(X, `select accept_invitation($1) c`, [em.token]))[0].c, em.conversation_id));
await t('Efter accept er pending_invitee tom', async () => assert.equal((await as(A, `select pending_invitee from list_my_conversations() where id=$1`, [em.conversation_id]))[0].pending_invitee, null));
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
  await as(A, `select submit_feedback('suggestion','Mere kontrast')`);
  await rejects(as(A, `select * from feedback`), /permission|denied/);
  await rejects(as(C, `select * from feedback`), /permission|denied/);
  assert.equal((await svc(`select count(*)::int n from feedback where user_id=$1`, [A]))[0].n, 1);
});
await t('Feedback: direkte indsættelse afvises', async () => rejects(as(A, `insert into feedback(user_id, body) values ($1,'x')`, [B]), /permission|denied|policy/));
await t('Feedback: ugyldig kategori afvises', async () => rejects(as(A, `select submit_feedback('spam','x')`), /bad_input|check|violat/));
await t('Feedback: for lang tekst afvises', async () => rejects(as(A, `select submit_feedback('suggestion',repeat('x',2001))`), /bad_input|check|violat/));
await t('Feedback: max 5 pr. døgn', async () => { for (let k = 0; k < 4; k++) await as(A, `select submit_feedback('suggestion','ok')`); await rejects(as(A, `select submit_feedback('complaint','sjette')`), /rate_limited/); });
await t('Feedback: anonym kan ikke indsende', async () => rejects(db.transaction(async (tx) => { await tx.exec(`set local role anon`); return tx.query(`select submit_feedback('other','x')`); }), /permission|denied/));

// GDPR: deletion (art. 17) and inactivity
const [P, Q, R] = (await db.query(`insert into auth.users(email) values ('p@test.invalid'),('q@test.invalid'),('r@test.invalid') returning id`)).rows.map(r => r.id);
let pc, solo;
await t('Sletning: opsætning (P og Q i samtale, P alene i en anden)', async () => {
  pc = (await as(P, `select create_conversation('x') c`))[0].c;
  const tk = (await as(P, `select * from create_invitation($1,'parent')`, [pc]))[0].token;
  await as(Q, `select accept_invitation($1)`, [tk]);
  solo = (await as(P, `select create_conversation('y') c`))[0].c;
  for (const [txt, k] of [['Leveret fra P', 'key-del00001']]) { const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [P, pc, await hash(txt)]))[0].id; await svc(`select * from commit_message($1,$2,$3,$4,$5)`, [id, P, pc, txt, k]); }
  await as(Q, `select * from get_messages($1)`, [pc]); // releases delivery
  // undelivered message: Q receives never
  await svc(`insert into receive_windows(user_id, weekday, start_min, end_min) select $1, (extract(isodow from now())::int % 7) + 1, 0, 1`, [Q]).catch(() => {});
  await as(P, `select set_conversation_color($1,'rose')`, [pc]);
  await as(P, `select set_contact_alias($1,'Q-alias')`, [Q]);
  await as(P, `select submit_feedback('suggestion','slet mig')`);
  await as(P, `select touch_seen()`);
});
await t('Klient kan ikke kalde purge_user_content / inactivity_sweep', async () => {
  await rejects(as(P, `select purge_user_content($1)`, [Q]), /permission denied/);
  await rejects(as(P, `select * from inactivity_sweep()`), /permission denied/);
});
let qBefore;
await t('Sletning: modparten har skrevet og modtaget før sletning', async () => {
  const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [Q, pc, await hash('Svar fra Q')]))[0].id;
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
await t('Blokér ord: andre kan ikke slette ejerens ord', async () => { await rejects(as(B, `delete from conversation_blocked_words`), /permission denied/); assert.equal((await svc(`select count(*)::int n from conversation_blocked_words where user_id=$1`, [A]))[0].n, 1); });
await t('Blokér ord: direkte insert afvises', async () => rejects(as(A, `insert into conversation_blocked_words(conversation_id,user_id,word) values ($1,$2,'xx')`, [conv, B]), /permission|denied/));
await t('Blokér ord: længde 2-120 (hele sætninger) og max 50', async () => { await rejects(as(A, `select add_blocked_word($1,'x',true)`, [conv]), /length/); await rejects(as(A, `select add_blocked_word($1,repeat('a',121),true)`, [conv]), /length/); for (let k = 0; k < 49; k++) await as(A, `select add_blocked_word($1,$2,true)`, [conv, 'ord' + k]); await rejects(as(A, `select add_blocked_word($1,'ord99',true)`, [conv]), /too_many/); await svc(`delete from conversation_blocked_words where word like 'ord%'`); });
await t('Blokér ord: server henter kun modtagernes ord (ikke afsenderens egne)', async () => { assert.deepEqual((await svc(`select * from recipient_blocked_words($1,$2) w`, [conv, B])).map(r => r.w), ['pis hoved']); assert.equal((await svc(`select * from recipient_blocked_words($1,$2)`, [conv, A])).length, 0); });
await t('Blokér ord: slettes ved kontosletning (cascade)', async () => { const [Z] = (await db.query(`insert into auth.users(email) values ('z@test.invalid') returning id`)).rows.map(r => r.id); const zc = (await as(Z, `select create_conversation('z') c`))[0].c; await as(Z, `select add_blocked_word($1,'hej',true)`, [zc]); await db.query(`delete from auth.users where id=$1`, [Z]); assert.equal((await svc(`select count(*)::int n from conversation_blocked_words where user_id=$1`, [Z]))[0].n, 0); });
await t('Blokering: B kan ikke sende, mens A blokerer (server)', async () => { await as(A, `select block_conversation($1)`, [conv]); await rejects(sendAs(B, 'Hej fra B', 'key-blk00001'), /cannot_deliver/); });
await t('Blokering: A (blokerende) kan stadig skrive', async () => { await sendAs(A, 'Hej fra A', 'key-blk00002'); });
await t('Blokering: B kan ikke se eller fjerne blokeringen', async () => { assert.equal((await as(B, `select * from conversation_blocks`)).length, 0); await as(B, `select unblock_conversation($1)`, [conv]); await rejects(sendAs(B, 'Hej igen', 'key-blk00003'), /cannot_deliver/); });
await t('Blokering: ingen udløbskolonne', async () => assert.deepEqual((await db.query(`select column_name from information_schema.columns where table_name='conversation_blocks' order by 1`)).rows.map(r => r.column_name), ['conversation_id', 'created_at', 'user_id']));
await t('Blokering: ophører kun når A afblokerer', async () => { await as(A, `select unblock_conversation($1)`, [conv]); await sendAs(B, 'Hej igen', 'key-blk00004'); });
await t('Feedback: kun Forslag/Klage kan indsendes; gamle filter-rækker forbliver gyldige', async () => { await svc(`delete from feedback`); await as(B, `select submit_feedback('complaint','x')`); await as(B, `select submit_feedback('suggestion','z')`); await rejects(as(B, `select submit_feedback('filter','y')`), /bad_input/); await rejects(as(B, `select submit_feedback('other','y')`), /bad_input/); await db.query(`insert into feedback(user_id,category,body) values ($1,'filter','gammel')`, [B]); assert.equal((await db.query(`select count(*)::int n from feedback where category='filter'`)).rows[0].n, 1); });

await t('Visningsnavn: andre ser altid e-mail (eller eget private kaldenavn); selvvalgt navn er fjernet', async () => {
  await db.query(`update auth.users set email='a-login@test.invalid' where id=$1`, [A]);
  await svc(`delete from contact_aliases where owner_id=$1`, [B]);
  const lbl = async () => (await as(B, `select others from list_my_conversations() where id=$1`, [conv]))[0].others.find(o => o.user_id === A).email;
  assert.equal(await lbl(), 'a-login@test.invalid');
  await rejects(as(A, `select set_my_public_name('Mor')`), /does not exist/);
  await rejects(as(A, `select get_my_public_name()`), /does not exist/);
  await rejects(as(A, `update profiles set public_name='Mor' where user_id=$1`, [A]), /profiles_public_name_removed|check constraint/);
  assert.equal(await lbl(), 'a-login@test.invalid');
  assert.ok((await as(B, `select * from get_messages($1)`, [conv])).filter(m => m.sender_id === A).every(m => m.sender_name === 'a-login@test.invalid'));
  assert.equal((await svc(`select public_label_of($1) l`, [A]))[0].l, 'a-login@test.invalid');
  await rejects(as(B, `select public_label_of($1)`, [A]), /permission|denied/);
  // The viewer's own private nickname still wins, and only for that viewer.
  await as(B, `select set_contact_alias($1,'Privat navn')`, [A]);
  assert.equal((await as(B, `select others from list_my_conversations() where id=$1`, [conv]))[0].others.find(o => o.user_id === A).alias, 'Privat navn');
  assert.ok((await as(B, `select * from get_messages($1)`, [conv])).filter(m => m.sender_id === A).every(m => m.sender_name === 'Privat navn'));
  await svc(`delete from contact_aliases where owner_id=$1`, [B]);
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

// ---------- Plans + attachments ----------
await t('Standardplan er Tekst; test-skift op gælder straks', async () => {
  const [U] = (await db.query(`insert into auth.users(raw_user_meta_data) values ('{}') returning id`)).rows.map(r => r.id);
  assert.equal((await as(U, `select plan from get_my_plan()`))[0].plan, 'text');
  assert.equal((await as(U, `select plan from set_my_plan_test('text_attachments')`))[0].plan, 'text_attachments');
  const d = (await as(U, `select plan, pending_plan from set_my_plan_test('text')`))[0];
  assert.equal(d.plan, 'text_attachments'); assert.equal(d.pending_plan, 'text');
  await db.query(`update user_plans set period_end = now() - interval '1 second' where user_id=$1`, [U]);
  assert.equal((await as(U, `select plan from get_my_plan()`))[0].plan, 'text');
  assert.equal((await as(U, `select plan from set_my_plan_test('text_attachments')`))[0].plan, 'text_attachments');
  assert.equal((await as(U, `select plan from set_my_plan_test('text', true)`))[0].plan, 'text');
  await rejects(as(U, `select * from set_my_plan_test('gratis')`), /bad_plan/);
  await db.query(`update app_flags set value=false where key='plan_test_switch'`);
  await rejects(as(U, `select * from set_my_plan_test('text_attachments')`), /plan_switch_disabled/);
  await db.query(`update app_flags set value=true where key='plan_test_switch'`);
});
await t('Vedhæftning kræver afsenders 79-plan; tabeller er lukkede for klienter', async () => {
  const [P, Q] = (await db.query(`insert into auth.users(raw_user_meta_data) values ('{}'),('{}') returning id`)).rows.map(r => r.id);
  const cv = (await db.query(`insert into conversations(created_by) values ($1) returning id`, [P])).rows[0].id;
  await db.query(`insert into memberships(conversation_id,user_id,role) values ($1,$2,'parent'),($1,$3,'parent')`, [cv, P, Q]);
  const data = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]);
  const h = (await db.query(`select encode(extensions.digest($1 || E'\n' || encode(extensions.digest($2::bytea,'sha256'),'hex'),'sha256'),'hex') h`, ['Vedhæftning: a.png', data])).rows[0].h;
  const ap = async () => (await svc(`select test_issue_current_approval($1,$2,$3,'openai','m') id`, [P, cv, h]))[0].id;
  const commit = async (k) => svc(`select * from commit_attachment_message($1,$2,$3,'Vedhæftning: a.png',$4,'image/png','a.png','alt',null,$5::bytea)`, [await ap(), P, cv, k, data]);
  await rejects(commit('key-att-0001'), /plan_required/);
  await as(P, `select * from set_my_plan_test('text_attachments')`);
  const mid = (await commit('key-att-0002'))[0].message_id;
  await rejects(as(Q, `select * from message_attachments`), /permission|denied/);
  await rejects(as(Q, `select * from user_plans where user_id='${P}'`).then(r => { if (r.length) throw new Error('leak'); throw new Error('denied'); }), /denied/);
  const g = await as(Q, `select att_mime from get_messages($1) where id=$2`, [cv, mid]);
  assert.equal(g[0]?.att_mime, 'image/png');
  assert.equal((await as(Q, `select mime from get_attachment($1)`, [mid]))[0].mime, 'image/png');
  await rejects(as(X, `select * from get_attachment($1)`, [mid]), /not_found/);
});

// ---------- Person limits + invite plan ----------
const mkConv = async (a, b) => { const cv = (await db.query(`insert into conversations(created_by) values ($1) returning id`, [a])).rows[0].id; await db.query(`insert into memberships(conversation_id,user_id,role) values ($1,$2,'parent'),($1,$3,'parent')`, [cv, a, b]); return cv; };
const sendIn = async (cv, from, text, key) => { const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [from, cv, await hash(text)]))[0].id; return svc(`select * from commit_message($1,$2,$3,$4,$5)`, [id, from, cv, text, key]); };
const [LP, LQ, LS] = (await db.query(`insert into auth.users(raw_user_meta_data) values ('{}'),('{}'),('{}') returning id`)).rows.map(r => r.id);
const lc1 = await mkConv(LP, LQ), lc2 = await mkConv(LQ, LP), lc3 = await mkConv(LS, LQ);
const lim = async (cv, s) => (await svc(`select * from _send_limits($1,$2)`, [cv, s]))[0];
await t('Retired length RPC ignores legacy inputs; membership protections unchanged', async () => {
  for (const n of [-1, 79, 80, 140, 250, 10001]) {
    const result=(await as(LQ, `select * from set_person_limit($1,$2,null)`, [LP,n]))[0];
    assert.equal(result.max_chars,null); assert.equal((await lim(lc1,LP)).max_chars,null);
  }
  await rejects(as(LQ, `select * from set_person_limit($1,140,null)`, [LQ]), /not_found/);
  const [Y] = (await db.query(`insert into auth.users(raw_user_meta_data) values ('{}') returning id`)).rows.map(r => r.id);
  await rejects(as(LQ, `select * from set_person_limit($1,140,null)`, [Y]), /not_found/);
});
await t('Existing recipient140 is inert across conversations; privacy remains', async () => {
  await svc(`insert into person_limits(recipient_id,sender_id,max_chars) values ($1,$2,140) on conflict(recipient_id,sender_id) do update set max_chars=140`,[LQ,LP]);
  for (const cv of [lc1,lc2]) { const row=await lim(cv,LP); assert.equal(row.max_chars,null); assert.equal(row.chars_by,null); }
  assert.equal((await lim(lc3,LS)).max_chars,null);
  assert.equal((await as(LP, `select * from person_limits`)).length,0);
  assert.equal((await as(LQ, `select * from person_limits`)).length,1);
  const composer=(await as(LP, `select * from get_my_send_limits($1)`,[lc1]))[0]; assert.equal(composer.max_chars,null); assert.equal(composer.chars_by,null);
  assert.equal((await as(LQ, `select max_chars from person_limits`))[0].max_chars,140,'migration semantics do not need to delete legacy settings');
});
await t('Legacy length input cannot reinstate cap or erase supplied frequency', async () => {
  const row=(await as(LQ, `select * from set_person_limit($1,140,5)`,[LP]))[0];
  assert.equal(row.max_chars,null); assert.equal(row.interval_min,5);
  const stored=(await as(LQ, `select max_chars,interval_min from person_limits`))[0]; assert.equal(stored.max_chars,null); assert.equal(stored.interval_min,5);
  await as(LQ, `select * from set_person_limit($1,250,60)`,[LP]);
  assert.equal((await as(LQ, `select interval_min from person_limits`))[0].interval_min,60);
  await as(LQ, `select * from set_person_limit($1,140,null)`,[LP]); assert.equal((await lim(lc1,LP)).next_at,null);
});
await t('Frekvensgrænse: 1..1440 min, på tværs af samtaler, DB-trigger, andre upåvirket', async () => {
  await rejects(as(LQ, `select * from set_person_limit($1,null,0)`, [LP]), /bad_interval/);
  await rejects(as(LQ, `select * from set_person_limit($1,null,1441)`, [LP]), /bad_interval/);
  await as(LQ, `select * from set_person_limit($1,null,5)`, [LP]);
  assert.equal((await lim(lc1, LP)).next_at, null);
  await sendIn(lc1, LP, 'Første besked', 'key-pl-0001');
  assert.ok((await lim(lc2, LP)).next_at);
  await rejects(sendIn(lc2, LP, 'Anden besked', 'key-pl-0002'), /person_frequency/);
  assert.equal((await db.query(`select count(*)::int n from messages where idempotency_key='key-pl-0002'`)).rows[0].n, 0, 'afvist besked må ikke gemmes');
  await sendIn(lc3, LS, 'Fra S', 'key-pl-0003');
  await sendIn(lc1, LQ, 'Q svarer', 'key-pl-0004');
  await db.query(`update messages set created_at = now() - interval '6 minutes' where idempotency_key='key-pl-0001'`);
  await sendIn(lc2, LP, 'Anden besked', 'key-pl-0005');
  await as(LQ, `select * from set_person_limit($1,null,60)`, [LP]);
  await db.query(`update messages set created_at = now() - interval '6 minutes' where idempotency_key='key-pl-0005'`);
  assert.ok((await lim(lc1, LP)).next_at);
  await as(LQ, `select * from set_person_limit($1,null,null)`, [LP]); assert.equal((await lim(lc1, LP)).next_at, null);
});
await t('Invitation af ekstra deltager kræver kun den inviterendes 79-plan', async () => {
  await rejects(as(LP, `select * from create_member_invitation($1,'ekstra@test.invalid','reader')`, [lc1]), /plan_required/);
  await as(LQ, `select * from set_my_plan_test('text_attachments')`);
  await rejects(as(LP, `select * from create_member_invitation($1,'ekstra@test.invalid','reader')`, [lc1]), /plan_required/);
  const r = await as(LQ, `select * from create_member_invitation($1,'ekstra@test.invalid','reader')`, [lc1]);
  assert.ok(r[0].invitation_id);
  await as(LP, `select consent_member_invitation($1)`, [r[0].invitation_id]);
  assert.ok((await as(LP, `select * from create_invitation($1,'parent')`, [await (async () => (await as(LP, `select create_conversation('ny') c`))[0].c)()]))[0].token);
});
// Additive reply contract: synthetic users, no AI/network.
const [RA,RB,RX] = (await db.query(`insert into auth.users(email) values ('a@example.invalid'),('b@example.invalid'),('x@example.invalid') returning id`)).rows.map(r=>r.id);
const rc=await mkConv(RA,RB), rcOther=await mkConv(RA,RX);
const original=(await sendIn(rc,RA,'Kan vi mødes kl. 16?','reply-original-001'))[0].message_id;
const elsewhere=(await sendIn(rcOther,RA,'Anden samtale','reply-other-001'))[0].message_id;
let response;
const replySend=async(target,key='reply-response-001')=>{
 const text='Ja, kl. 16 passer.';
 const ap=(await svc(`select test_issue_current_approval($1,$2,$3,'test','m',$4) id`,[RB,rc,await hash(text),target]))[0].id;
 return svc(`select * from commit_message_reply($1,$2,$3,$4,$5,$6)`,[ap,RB,rc,text,key,target]);
};
await t('Reply: visible target accepted atomically and persists',async()=>{response=(await replySend(original))[0].message_id; const rows=await as(RB,`select * from get_messages_v2($1)`,[rc]);const m=rows.find(m=>m.id===response);assert.equal(m.reply_to_id,original);assert.equal(m.reply_body,'Kan vi mødes kl. 16?');assert.equal(m.sender_email,'b@example.invalid');assert.equal(m.has_reply,true);});
await t('Reply: actual email independent of private nickname; old RPC unchanged',async()=>{await as(RB,`select set_contact_alias($1,'Privat navn')`,[RA]); const m=(await as(RB,`select * from get_messages_v2($1)`,[rc])).find(m=>m.id===original);assert.equal(m.sender_name,'Privat navn');assert.equal(m.sender_email,'a@example.invalid');assert.ok(!('reply_to_id' in (await as(RB,`select * from get_messages($1)`,[rc]))[0]));});
await t('Reply: cross-conversation target rejected, no storage',async()=>{await rejects(replySend(elsewhere,'reply-cross-001'),/invalid_reply/);assert.equal((await db.query(`select count(*)::int n from messages where idempotency_key='reply-cross-001'`)).rows[0].n,0);});
await t('Reply: idempotent retry immutable; changed target rejected',async()=>{assert.equal((await replySend(original))[0].duplicate,true);await rejects(replySend(null),/idempotency_conflict/);});
await t('Reply: old approval cannot be rebound to an original',async()=>{const ap=(await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`,[RB,rc,await hash('Test svar')]))[0].id;await rejects(svc(`select * from commit_message_reply($1,$2,$3,'Test svar','reply-unbound-001',$4)`,[ap,RB,rc,original]),/approval_invalid/);});
await t('Reply: client cannot commit, mutate refs or read other conversation',async()=>{await rejects(as(RB,`select * from commit_message_reply(gen_random_uuid(),$1,$2,'hi','reply-forged-001',$3)`,[RB,rc,original]),/permission denied/);await rejects(as(RX,`select * from get_messages_v2($1)`,[rc]),/not_member/);await rejects(as(RB,`select * from message_replies`),/permission denied/);});
await t('Reply: unreleased target is forbidden and not leaked in quotes',async()=>{
 await db.query(`update message_deliveries set released_at=null where message_id=$1 and recipient_id=$2`,[original,RB]);
 await db.query(`insert into receive_settings(user_id,timezone,enabled) values($1,'Europe/Copenhagen',true)`,[RB]);
 const dow=(await db.query(`select extract(isodow from now() at time zone 'Europe/Copenhagen')::int d`)).rows[0].d;
 await db.query(`insert into receive_windows(user_id,weekday,start_minute,end_minute) values($1,$2,1,2)`,[RB,dow===1?3:1]);
 await rejects(svc(`select assert_reply_target($1,$2,$3)`,[RB,rc,original]),/invalid_reply/);
 const m=(await as(RB,`select * from get_messages_v2($1)`,[rc])).find(m=>m.id===response);assert.equal(m.reply_body,null);
 await db.query(`update receive_settings set enabled=false where user_id=$1`,[RB]);
});
await t('Reply: attachment uses same validated reference and exact retry identity',async()=>{
 await as(RB,`select * from get_messages($1)`,[rc]);
 await as(RB,`select * from set_my_plan_test('text_attachments')`);
 const txt='Testfil',data=new Uint8Array([0x89,0x50,0x4e,0x47]);
 const fh=(await db.query(`select encode(extensions.digest($1::bytea,'sha256'),'hex') h`,[data])).rows[0].h;
 const ap=(await svc(`select test_issue_current_approval($1,$2,$3,'test','m',$4) id`,[RB,rc,await hash(txt+'\n'+fh),original]))[0].id;
 const params=[ap,RB,rc,txt,'reply-file-001','image/png','test.png','',null,data,original];
 const sql=`select * from commit_attachment_reply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::bytea,$11)`;
 const result=await svc(sql,params);assert.equal(result[0].duplicate,false);
 assert.equal((await svc(sql,params))[0].duplicate,true);
 await rejects(svc(`select * from commit_message_reply(gen_random_uuid(),$1,$2,$3,'reply-file-001',$4)`,[RB,rc,txt,original]),/idempotency_conflict/);
 const changed=[...params];changed[6]='changed.png';await rejects(svc(sql,changed),/idempotency_conflict/);
 assert.equal((await as(RB,`select * from get_messages_v2($1)`,[rc])).find(m=>m.id===result[0].message_id).reply_to_id,original);
});
await t('Reply: membership and per-recipient retention apply to original and quote',async()=>{
 await db.query(`update memberships set joined_at=now()-interval '3 years' where conversation_id=$1`,[rc]);
 await db.query(`update messages set created_at=now()-interval '2 years' where id=$1`,[original]);
 await as(RA,`select set_my_data_prefs(false,'5y')`);
 assert.ok((await as(RA,`select * from get_messages_v2($1)`,[rc])).find(m=>m.id===response).reply_body);
 assert.equal((await as(RB,`select * from get_messages_v2($1)`,[rc])).find(m=>m.id===response).reply_body,null);
 await rejects(svc(`select assert_reply_target($1,$2,$3)`,[RB,rc,original]),/invalid_reply/);
 assert.equal((await svc(`select * from commit_message_reply(gen_random_uuid(),$1,$2,'Ja, kl. 16 passer.','reply-response-001',$3)`,[RB,rc,original]))[0].duplicate,true);
 await db.query(`update messages set created_at=now() where id=$1`,[original]);
 await db.query(`update memberships set role='reader' where conversation_id=$1 and user_id=$2`,[rc,RB]);
 await rejects(svc(`select assert_reply_target($1,$2,$3)`,[RB,rc,original]),/invalid_reply/);
 await db.query(`update memberships set role='parent',joined_at=now()+interval '1 day' where conversation_id=$1 and user_id=$2`,[rc,RB]);
 await rejects(svc(`select assert_reply_target($1,$2,$3)`,[RB,rc,original]),/invalid_reply/);
 await db.query(`update memberships set joined_at=now()-interval '1 day' where conversation_id=$1 and user_id=$2`,[rc,RB]);
});
await t('Reply: deleted target no snapshot survives',async()=>{await db.query(`delete from messages where id=$1`,[original]);const m=(await as(RB,`select * from get_messages_v2($1)`,[rc])).find(m=>m.id===response);assert.equal(m.reply_to_id,null);assert.equal(m.reply_body,null);assert.equal(m.has_reply,true);});
await t('Reply: identical retry after target deletion accepted, changed identity rejected',async()=>{assert.equal((await svc(`select * from commit_message_reply(gen_random_uuid(),$1,$2,'Ja, kl. 16 passer.','reply-response-001',$3)`,[RB,rc,original]))[0].duplicate,true);await rejects(svc(`select * from commit_message_reply(gen_random_uuid(),$1,$2,'Ja, kl. 16 passer.','reply-response-001',null)`,[RB,rc]),/idempotency_conflict/);});
// Plan-specific product quotas. Synthetic users/conversation only.
{
const [P49,P79] = (await db.query(`insert into auth.users(email) values ('quota49@example.invalid'),('quota79@example.invalid') returning id`)).rows.map(r=>r.id);
await db.query(`insert into user_plans(user_id,plan) values ($1,'text'),($2,'text_attachments')`,[P49,P79]);
const pc=(await as(P49,`select create_conversation('Quota synthetic') c`))[0].c;
const pt=(await as(P49,`select * from create_invitation($1,'parent')`,[pc]))[0].token;
await as(P79,`select accept_invitation($1)`,[pt]);
const quotaSend=async(uid,body,key)=>{const aid=(await svc(`select test_issue_current_approval($1,$2,$3,'test','synthetic',null) id`,[uid,pc,await hash(body)]))[0].id;return svc(`select * from commit_message_reply($1,$2,$3,$4,$5,null)`,[aid,uid,pc,body,key]);};
await t('Old recipient140 does not override49/79 quotas or composer contract',async()=>{
 await svc(`insert into person_limits(recipient_id,sender_id,max_chars) values ($1,$2,140),($2,$1,140)`,[P49,P79]);
 for(const uid of [P49,P79]) { const row=(await as(uid,`select * from get_my_send_limits($1)`,[pc]))[0];assert.equal(row.max_chars,null);assert.equal(row.chars_by,null); }
 await svc(`select * from prepare_send($1,$2,$3)`,[P49,pc,'v'.repeat(160)]);
 await svc(`select * from prepare_send($1,$2,$3)`,[P79,pc,'v'.repeat(480)]);
});
await t('Plan quotas: authoritative49/79 limits; helper not client-accessible',async()=>{assert.equal((await svc(`select message_char_limit($1) n`,[P49]))[0].n,160);assert.equal((await svc(`select message_char_limit($1) n`,[P79]))[0].n,480);await rejects(as(P49,`select message_char_limit($1)`,[P79]),/permission denied/);});
await t('Plan49:160 accepted,161 blocked in prepare and direct commit',async()=>{await svc(`select * from prepare_send($1,$2,$3)`,[P49,pc,'x'.repeat(160)]);await quotaSend(P49,'x'.repeat(160),'quota-49-160');await rejects(svc(`select * from prepare_send($1,$2,$3)`,[P49,pc,'x'.repeat(161)]),/plan_length_limit:160/);await rejects(quotaSend(P49,'x'.repeat(161),'quota-49-161'),/plan_length_limit:160/);});
await t('Legacy text commit cannot bypass49 plan quota',async()=>{const txt='l'.repeat(161);const aid=(await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`,[P49,pc,await hash(txt)]))[0].id;await rejects(svc(`select * from commit_message($1,$2,$3,$4,'quota-legacy-161')`,[aid,P49,pc,txt]),/plan_length_limit:160/);});
await t('Plan79:480 accepted and481 blocked',async()=>{await svc(`select * from prepare_send($1,$2,$3)`,[P79,pc,'x'.repeat(480)]);await quotaSend(P79,'x'.repeat(480),'quota-79-480');await rejects(quotaSend(P79,'x'.repeat(481),'quota-79-481'),/plan_length_limit:480|check constraint/);});
await t('Plan limit counts Unicode codepoints, not UTF16',async()=>{await quotaSend(P49,'𐀀'.repeat(160),'quota-unicode-160');await rejects(quotaSend(P49,'𐀀'.repeat(161),'quota-unicode-161'),/plan_length_limit:160/);});
await t('Downgrade during moderation rechecked; accepted historical retry still succeeds',async()=>{const txt='y'.repeat(200);await svc(`select * from prepare_send($1,$2,$3)`,[P79,pc,txt]);await db.query(`update user_plans set plan='text' where user_id=$1`,[P79]);await rejects(quotaSend(P79,txt,'quota-downgrade-new'),/plan_length_limit:160/);const retry=await svc(`select * from commit_message_reply(gen_random_uuid(),$1,$2,$3,'quota-79-480',null)`,[P79,pc,'x'.repeat(480)]);assert.equal(retry[0].duplicate,true);await db.query(`update user_plans set plan='text_attachments' where user_id=$1`,[P79]);});
await t('Pending downgrade is effective at prepare/commit without trusting old client plan',async()=>{await db.query(`update user_plans set pending_plan='text',period_end=now()-interval '1 second' where user_id=$1`,[P79]);assert.equal((await svc(`select message_char_limit($1) n`,[P79]))[0].n,160);await rejects(quotaSend(P79,'q'.repeat(161),'quota-pending'),/plan_length_limit:160/);await db.query(`update user_plans set plan='text_attachments',pending_plan=null where user_id=$1`,[P79]);});
const quotaFile=async(uid,txt,key)=>{
 const data=Buffer.from([137,80,78,71]).toString('hex');
 const h=(await db.query(`select encode(extensions.digest($1||E'\\n'||encode(extensions.digest(decode($2,'hex'),'sha256'),'hex'),'sha256'),'hex') h`,[txt,data])).rows[0].h;
 const aid=(await svc(`select test_issue_current_approval($1,$2,$3,'test','m',null) id`,[uid,pc,h]))[0].id;
 return svc(`select * from commit_attachment_reply($1,$2,$3,$4,$5,'image/png','synthetic.png','',null,decode($6,'hex'),null)`,[aid,uid,pc,txt,key,data]);
};
await t('Plan79 attachment caption480 commits;481 rejected;49 still forbidden',async()=>{
 await quotaFile(P79,'z'.repeat(480),'quota-file-480');
 await rejects(quotaFile(P79,'z'.repeat(481),'quota-file-481'),/plan_length_limit:480|check constraint/);
 await rejects(quotaFile(P49,'Kort','quota49-file'),/plan_required/);
});
}
const {testClarificationPolicy}=await import('./clarification-policy.mjs');
await testClarificationPolicy({db,as,svc,hash,t,assert});
const {testBlockingTopics}=await import('./blocking-topics.mjs');
await testBlockingTopics({db,as,svc,hash,t,assert});
const {testConversationExports}=await import('./conversation-exports.mjs');
await testConversationExports({db,as,svc,hash,t,assert});
const {testConversationList}=await import('./conversation-list.mjs');
await testConversationList({db,as,svc,hash,t,assert});
const {testReplyContext}=await import('./reply-context.mjs');
const {testRemovePublicName}=await import('./remove-public-name.mjs');
await testReplyContext({db,as,svc,hash,t,assert});
await testRemovePublicName({t,assert});
const {testEmailChangeNotice}=await import('./email-change-notice.mjs');
await testEmailChangeNotice({db,as,svc,hash,t,assert});
const {testAppLocale}=await import('./app-locale.mjs');
await testAppLocale({db,as,svc,hash,t,assert,rejects});
console.log(`\n${pass} bestået, ${fail} fejlet`);
process.exit(fail ? 1 : 0);
