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
  create table auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}');
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
console.log(`\n${pass} bestået, ${fail} fejlet`);
process.exit(fail ? 1 : 0);
