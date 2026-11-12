import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
export function guardedURL(){
 const raw=process.env.TIMEZONE_TEST_DATABASE_URL;
 if(process.env.CI!=='true'||process.env.TIMEZONE_SQL_TEST!=='synthetic-only'||!raw)throw Error('Explicit synthetic CI database opt-in required');
 const u=new URL(raw);
 if(u.protocol!=='postgresql:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username!=='rolff_timezone_test'||!/^\/rolff_test_[a-z0-9_]+$/.test(u.pathname)||u.search||u.hash)throw Error('Refusing non-local/non-test database');
 return raw;
}
export async function connectPG(){
 const url=guardedURL();const {Client}=await import('pg');
 const c=new Client({connectionString:url,connectionTimeoutMillis:5000,application_name:'rolff-timezone-synthetic-ci'});
 await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='5s';set idle_in_transaction_session_timeout='15s'");return c;
}
async function createDatabase(){
 if(process.env.TIMEZONE_SQL_BACKEND!=='postgres')return new PGlite({extensions:{pgcrypto}});
 const c=await connectPG();
 const identity=(await c.query('select current_database() db,current_user usr')).rows[0];
 if(!identity.db.startsWith('rolff_test_')||identity.usr!=='rolff_timezone_test')throw Error('Unexpected database identity');
 if((await c.query("select to_regclass('public.receive_settings') x")).rows[0].x)throw Error('Test database must be fresh');
 const wrap={query:(...a)=>c.query(...a),exec:(s)=>c.query(s),close:()=>c.end(),transaction:async(fn)=>{await c.query('begin');try{const r=await fn(wrap);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}}};return wrap;
}
export async function bootstrap(){
const db=await createDatabase();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema extensions;
  create table auth.users(id uuid primary key default gen_random_uuid(), email varchar(255), raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
  grant usage on schema auth, public, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
const dir=new URL('../../supabase/migrations/',import.meta.url);
const mig=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
const targets=mig.filter(f=>f.endsWith('_receive_timezone_preferences.sql'));
if(targets.length!==1)throw Error('Expected exactly one timezone migration');
const cut=mig.indexOf(targets[0]);
for(const f of mig.slice(0,cut)) await db.exec(fs.readFileSync(new URL(f,dir),'utf8'));
const [OLD,U,V,BROKEN]=(await db.query(`insert into auth.users(raw_user_meta_data) values ('{"display_name":"Fabricated legacy"}'),('{"display_name":"Fabricated auto"}'),('{"display_name":"Fabricated other"}'),('{"display_name":"Fabricated broken empty"}') returning id`)).rows.map(x=>x.id);
await db.query(`insert into receive_settings(user_id,timezone,enabled) values($1,'America/New_York',true)`,[OLD]);
await db.query(`insert into receive_windows(user_id,weekday,start_minute,end_minute) values($1,2,600,900)`,[OLD]);
const repair=mig.find(f=>f.endsWith('_receive_windows_required.sql'));
if(!repair)throw Error('Expected receive_windows_required migration');
for(const f of mig.slice(cut)){
  if(f===repair){
    // Seed the pre-repair broken state immediately before the repair migration runs.
    await db.query(`insert into receive_settings(user_id,timezone,enabled,timezone_mode,timezone_revision) values($1,'Europe/Copenhagen',true,'fixed',1)`,[BROKEN]);
  }
  await db.exec(fs.readFileSync(new URL(f,dir),'utf8'));
}

return {db,OLD,U,V,BROKEN};
}
