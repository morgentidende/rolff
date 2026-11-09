// Real PostgreSQL 17 (synthetic CI database only, same opt-in guard as the timezone suite):
// all migrations + the export suite + a parallel rate-limit race.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { connectPG } from './timezone-test-db.mjs';
import { testConversationExports } from './conversation-exports.mjs';
if (process.env.TIMEZONE_SQL_BACKEND !== 'postgres') throw Error('This test requires real PostgreSQL');
const c = await connectPG();
if ((await c.query("select to_regclass('public.messages') x")).rows[0].x) throw Error('Test database must be fresh');
await c.query(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions; create extension if not exists pgcrypto with schema extensions;
  create table auth.users(id uuid primary key default gen_random_uuid(), email varchar(255), raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
  grant usage on schema auth, public, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;`);
const dir = new URL('../../supabase/migrations/', import.meta.url);
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await c.query(fs.readFileSync(new URL(f, dir), 'utf8'));
const tx = async (fn) => { await c.query('begin'); try { const r = await fn(); await c.query('commit'); return r; } catch (e) { await c.query('rollback'); throw e; } };
const db = { query: (...a) => c.query(...a) };
const as = (uid, sql, p = []) => tx(async () => { await c.query(`set local role authenticated; select set_config('request.jwt.sub', '${uid}', true)`); return (await c.query(sql, p)).rows; });
const svc = (sql, p = []) => tx(async () => { await c.query('set local role service_role'); return (await c.query(sql, p)).rows; });
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, '-', e.message); } };
await testConversationExports({ db, as, svc, t, assert });
await t('PG17: parallelle eksporter kan ikke omgå timegrænsen (advisory lock)', async () => {
  const u = (await c.query(`insert into auth.users(email) values('race@example.invalid') returning id`)).rows[0].id;
  await c.query(`insert into user_plans(user_id,plan) values($1,'text_attachments')`, [u]);
  const cv = (await c.query(`insert into conversations(created_by) values($1) returning id`, [u])).rows[0].id;
  await c.query(`insert into memberships(conversation_id,user_id,role) values($1,$2,'parent')`, [cv, u]);
  const clients = await Promise.all(Array.from({ length: 6 }, () => connectPG()));
  const res = await Promise.allSettled(clients.map(async (k) => { await k.query('begin'); await k.query('set local role service_role'); const r = await k.query(`select * from begin_conversation_export($1,$2,null,null,'self',null)`, [u, cv]); await new Promise(r => setTimeout(r, 50)); await k.query('commit'); return r; }));
  await Promise.all(clients.map(k => k.end().catch(() => {})));
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(res.filter(r => r.status === 'rejected').every(r => /rate_limited/.test(r.reason.message)));
});
await c.end();
console.log(`\n${pass} bestået, ${fail} fejlet`);
process.exit(fail ? 1 : 0);
