// Real PostgreSQL 17 (synthetic CI database only, same opt-in guard as the other *-postgres suites):
// parallel uploads by one sender can never exceed the daily attachment cap (5 per rolling 24h).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { connectPG } from './timezone-test-db.mjs';
if (process.env.TIMEZONE_SQL_BACKEND !== 'postgres') throw Error('This test requires real PostgreSQL parallel connections');
const admin = await connectPG(), clients = [];
if ((await admin.query("select to_regclass('public.messages') x")).rows[0].x) throw Error('Test database must be fresh');
await admin.query(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions; create extension if not exists pgcrypto with schema extensions;
  create table auth.users(id uuid primary key default gen_random_uuid(), email varchar(255), raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
  grant usage on schema auth, public, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;`);
const dir = new URL('../../supabase/migrations/', import.meta.url);
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await admin.query(fs.readFileSync(new URL(f, dir), 'utf8'));
const client = async () => { const c = await connectPG(); clients.push(c); return c; };
const reflected = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const [A, B] = (await admin.query(`insert into auth.users(raw_user_meta_data) values ('{}'),('{}') returning id`)).rows.map(r => r.id);
const cv = (await admin.query('insert into conversations(created_by) values($1) returning id', [A])).rows[0].id;
await admin.query(`insert into memberships(conversation_id,user_id,role) values($1,$2,'parent'),($1,$3,'parent')`, [cv, A, B]);
await admin.query(`insert into user_plans(user_id,plan) values($1,'text_attachments'),($2,'text_attachments')`, [A, B]);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok', name); };
try {
  await test('10 parallel slot reservations: exactly 5 pass, the rest are refused before any model call', async () => {
    const cs = await Promise.all(Array.from({ length: 10 }, client));
    const res = await Promise.all(cs.map((c, i) => reflected(c.query('select reserve_attachment_slot($1,$2)', [A, 'race-slot-' + i]))));
    assert.equal(res.filter(r => !r.error).length, 5);
    assert.ok(res.filter(r => r.error).every(r => /daily_attachment_limit/.test(r.error.message)));
    assert.equal((await admin.query('select attachment_daily_used($1) n', [A])).rows[0].n, 5);
    assert.equal((await admin.query('select attachment_daily_used($1) n', [B])).rows[0].n, 0);
    await admin.query('delete from attachment_slots');
  });
  await test('8 parallel commits by one sender: exactly 5 attachments are stored', async () => {
    const jobs = [];
    for (let i = 0; i < 8; i++) {
      const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, i]);
      const h = (await admin.query(`select encode(extensions.digest($1 || E'\\n' || encode(extensions.digest($2::bytea,'sha256'),'hex'),'sha256'),'hex') h`, ['Vedhæftning: a.png', data])).rows[0].h;
      const id = (await admin.query("select issue_reply_approval_v3($1,$2,$3,'test','fabricated',$4,null) id", [B, cv, h, (await admin.query('select recipient_filter_snapshot($1,$2) s', [cv, B])).rows[0].s.revision])).rows[0].id;
      jobs.push({ id, data, i });
    }
    const cs = await Promise.all(jobs.map(client));
    const res = await Promise.all(jobs.map((j, k) => reflected(cs[k].query("select * from commit_attachment_message($1,$2,$3,'Vedhæftning: a.png',$4,'image/png','a.png','alt',null,$5)", [j.id, B, cv, 'race-commit-' + j.i, j.data]))));
    assert.equal(res.filter(r => !r.error).length, 5, JSON.stringify(res.map(r => r.error?.message)));
    assert.ok(res.filter(r => r.error).every(r => /daily_attachment_limit/.test(r.error.message)));
    assert.equal((await admin.query('select count(*)::int n from messages m join message_attachments a on a.message_id=m.id where m.sender_id=$1', [B])).rows[0].n, 5);
  });
  console.log(passed + ' attachment concurrency scenarios passed');
} finally { await Promise.all(clients.map(c => c.end().catch(() => {}))); await admin.end(); }
