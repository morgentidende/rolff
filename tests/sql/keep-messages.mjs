// Keep messages by default + the 3-day warning before a shorter retention limit would hide the first messages.
// Synthetic data only, no network, no real mail or push.
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import {bootstrap} from './timezone-test-db.mjs';
import {closedWindows} from './notification-fixtures.mjs';
let pass=0;
const test=async(name,f)=>{await f();pass++;console.log('ok',name);};

// ---- A. Migration moves nothing: existing rows keep their value (we cannot tell a chosen '1y' from the old default).
{
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key default gen_random_uuid(), email varchar(255), raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
    grant usage on schema auth, public, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  const dir=new URL('../../supabase/migrations/',import.meta.url);
  const mig=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  const mine=mig.find(f=>f.endsWith('_keep_messages_default.sql'));
  assert.ok(mine);
  for(const f of mig.slice(0,mig.indexOf(mine)))await db.exec(fs.readFileSync(new URL(f,dir),'utf8'));
  const u=(await db.query(`insert into auth.users(email) values ('old1@example.invalid'),('old2@example.invalid'),('old3@example.invalid') returning id`)).rows.map(r=>r.id);
  await db.query(`insert into user_privacy(user_id) values ($1)`,[u[0]]);                                   // old default
  await db.query(`insert into user_privacy(user_id,retention) values ($1,'5y'),($2,'unlimited')`,[u[1],u[2]]); // explicit
  const before=(await db.query('select user_id,retention,updated_at from user_privacy order by user_id')).rows;
  assert.equal(before.find(r=>r.user_id===u[0]).retention,'1y','old default was 1y');
  for(const f of mig.slice(mig.indexOf(mine)))await db.exec(fs.readFileSync(new URL(f,dir),'utf8'));
  await test('migration leaves every existing row exactly as it was (value and updated_at); no explicit choice is changed',async()=>{
    const after=(await db.query('select user_id,retention,updated_at from user_privacy order by user_id')).rows;
    assert.deepEqual(after,before);
    assert.equal((await db.query('select count(*)::int n from user_privacy where retention_warned_at is not null')).rows[0].n,0);
  });
  await test('a new row gets the new default (keep forever); a user without a row is keep-forever too',async()=>{
    const n=(await db.query(`insert into auth.users(email) values ('new@example.invalid') returning id`)).rows[0].id;
    await db.query('insert into user_privacy(user_id) values ($1)',[n]);
    assert.equal((await db.query('select retention from user_privacy where user_id=$1',[n])).rows[0].retention,'unlimited');
    const none=(await db.query(`insert into auth.users(email) values ('norow@example.invalid') returning id`)).rows[0].id;
    assert.equal((await db.query('select _retention_cutoff($1)::text c',[none])).rows[0].c,'-infinity');
  });
  await test('sweep, old default (1y) still in place: nothing is deleted while the message is younger than 1 year or any member keeps it',async()=>{
    const [a,b]=u;const c=(await db.query(`insert into conversations(title,created_by) values ('Synthetic',$1) returning id`,[a])).rows[0].id;
    await db.query(`insert into memberships(conversation_id,user_id,role) values ($1,$2,'parent'),($1,$3,'parent')`,[c,a,b]);
    const ins=async(age,key)=>(await db.query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,created_at) values ($1,$2,'x','h',$3,now()-$4::interval) returning id`,[c,a,key,age])).rows[0].id;
    const young=await ins('300 days','young-0001'),oldKept=await ins('2 years','oldkept-1');
    await db.exec(`set local role service_role`);await db.exec('reset role');
    // member b (u[1]) is '5y' -> the 2-year-old message is still inside b's limit
    await db.query('select retention_sweep()');
    assert.equal((await db.query('select count(*)::int n from messages where id in ($1,$2)',[young,oldKept])).rows[0].n,2);
    await db.query(`update user_privacy set retention='unlimited' where user_id=$1`,[a]);
    await db.query('select retention_sweep()');
    assert.equal((await db.query('select count(*)::int n from messages where id in ($1,$2)',[young,oldKept])).rows[0].n,2,'unlimited member keeps everything');
  });
  await db.close();
}

// ---- B. Warning logic
const {db,U,V}=await bootstrap();
const query=async(sql,p=[])=>(await db.query(sql,p)).rows;
const as=async(uid,sql,p=[])=>db.transaction(async tx=>{await tx.exec(`set local role authenticated;select set_config('request.jwt.sub','${uid}',true)`);return (await tx.query(sql,p)).rows;});
const svc=async(sql,p=[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return(await tx.query(sql,p)).rows;});
const pub='B'+'A'.repeat(86),auth='A'.repeat(22),endpoint='https://fcm.googleapis.com/fcm/send/SyntheticOnly';
const claimPush=()=>svc('select * from claim_push_work()');
const prepare=async w=>(await svc('select prepare_push($1,$2,$3) s',[w.job_id,w.subscription_id,w.lease]))[0].s;
const jobs=()=>query("select * from notification_jobs where kind='retention_warning' order by id");
await query('update push_runtime set enabled=true,vapid_public_key=$1',[pub]);
await query("update auth.users set email=$2 where id=$1",[U,'u@example.invalid']);
await query("update auth.users set email=$2 where id=$1",[V,'v@example.invalid']);
const conv=(await as(U,"select create_conversation('Synthetic') id"))[0].id;
const tok=(await as(U,"select * from create_invitation($1,'parent')",[conv]))[0].token;
await as(V,'select accept_invitation($1)',[tok]);
let k=0;
const msg=async(age)=>{const id=(await query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,created_at) values ($1,$2,'Synthetic body','h',$3,now()-$4::interval) returning id`,[conv,V,`keep-${++k}-padding`,age]))[0].id;
  await query('insert into message_deliveries(message_id,recipient_id,released_at) values ($1,$2,now())',[id,U]);return id;};
const reset=async()=>{await query('delete from notification_jobs');await query('delete from push_attempts');await query('delete from messages');
  await query('delete from user_privacy');await query("update memberships set joined_at=now()-interval '10 years'");};
const setRet=(uid,r)=>as(uid,'select set_my_data_prefs(false,$1)',[r]);
const pushOn=async()=>{await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);};
await pushOn();
const windowsOff=async()=>{const s=(await as(U,'select get_my_receive_settings(null) s'))[0].s;await as(U,"select save_my_receive_settings($1,$3::jsonb,'fixed','UTC',null,$2)",[false,s.revision,'[]']);};
await windowsOff();

await test('keep forever is the default: no row -> get_my_privacy says unlimited; nothing ever expires, nothing is warned',async()=>{
  await reset();await msg('3 years');
  assert.equal((await as(U,'select * from get_my_privacy()'))[0].retention,'unlimited');
  assert.equal((await as(U,'select count(*)::int n from get_messages($1)',[conv]))[0].n,1,'still visible after 3 years');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false);
  assert.equal((await svc('select * from claim_retention_warnings()')).length,0);
  await svc('select retention_sweep()');assert.equal((await query('select count(*)::int n from messages'))[0].n,1,'nothing deleted');
});
await test('window: only messages that pass the limit within 3 days count (1y and 5y); already hidden and later ones do not',async()=>{
  await reset();await setRet(U,'1y');
  await msg('364 days');                       // hidden in ~1 day
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,true);
  await reset();await setRet(U,'1y');await msg('300 days');await msg('1 year 10 days');   // far from it / already hidden
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false);
  await reset();await setRet(U,'1y');await msg('1 year 364 days');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false,'already hidden for them -> nothing new to warn about');
  await reset();await setRet(U,'1y');await msg('361 days');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false,'4 days left: too early (the warning is 3 days before)');
  await msg('362 days 12 hours');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,true,'2.5 days left');
  await reset();await setRet(U,'5y');await msg('5 years');
  await reset();await setRet(U,'5y');await msg('1824 days');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,true,'5y works the same way');
});
await test('visibility rules match get_messages: messages from before joining or still undelivered do not trigger a warning',async()=>{
  await reset();await setRet(U,'1y');
  await query("update memberships set joined_at=now() where user_id=$1",[U]);await msg('364 days');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false,'before they joined');
  await reset();await setRet(U,'1y');const id=await msg('364 days');await query('update message_deliveries set released_at=null where message_id=$1',[id]);
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false,'not delivered to them');
  await reset();await setRet(U,'1y');await query("update memberships set left_at=now() where user_id=$1",[U]);await msg('364 days');
  assert.equal((await svc('select retention_has_expiring($1) x',[U]))[0].x,false,'left the conversation');
  await query('update memberships set left_at=null');
});
await test('claim: returns who to mail (address, language, choice), marks them, one push job only for users with notifications on',async()=>{
  await reset();await setRet(U,'1y');await setRet(V,'5y');await msg('364 days');
  // V sent that message, and it is also theirs -> expiring for V only when inside 5y: not (364 days)
  const r=await svc('select * from claim_retention_warnings()');
  assert.equal(r.length,1);assert.equal(r[0].user_id,U);assert.equal(r[0].email,'u@example.invalid');assert.equal(r[0].lang,'da');assert.equal(r[0].retention,'1y');
  assert.deepEqual(Object.keys(r[0]).sort(),['email','lang','retention','user_id']);
  const j=await jobs();assert.equal(j.length,1);assert.equal(j[0].user_id,U);assert.equal(j[0].conversation_id,null);assert.equal(j[0].subject_id,null);assert.equal(j[0].invitation_id,null);
  assert.ok((await query('select retention_warned_at from user_privacy where user_id=$1',[U]))[0].retention_warned_at);
  assert.equal((await query('select retention_warned_at from user_privacy where user_id=$1',[V]))[0].retention_warned_at,null);
  // no notifications -> mail only
  await reset();await setRet(U,'1y');await as(U,'select revoke_my_push(null,true)');await msg('364 days');
  assert.equal((await svc('select * from claim_retention_warnings()')).length,1);assert.equal((await jobs()).length,0);
  await pushOn();
});
await test('language follows the app language (en)',async()=>{
  await reset();await setRet(U,'1y');await msg('364 days');await as(U,"select set_my_locale('en')").catch(()=>query("insert into user_locale(user_id,locale) values ($1,'en') on conflict (user_id) do update set locale='en'",[U]));
  const r=await svc('select * from claim_retention_warnings()');assert.equal(r[0].lang,'en');
  await query("delete from user_locale where user_id=$1",[U]).catch(()=>{});
});
await test('once per batch: a second run sends nothing; 30-day cooldown; a changed choice starts a new batch',async()=>{
  await reset();await setRet(U,'1y');await msg('364 days');
  assert.equal((await svc('select * from claim_retention_warnings()')).length,1);
  assert.equal((await svc('select * from claim_retention_warnings()')).length,0,'same day, same batch');
  await msg('363 days');
  await query("update user_privacy set retention_warned_at=now()-interval '10 days'");
  assert.equal((await svc('select * from claim_retention_warnings()')).length,0,'inside the 30-day cooldown');
  await query("update user_privacy set retention_warned_at=now()-interval '31 days'");
  assert.equal((await svc('select * from claim_retention_warnings()')).length,1,'new batch after the cooldown');
  await setRet(U,'5y');assert.equal((await query('select retention_warned_at from user_privacy where user_id=$1',[U]))[0].retention_warned_at,null,'a new choice resets the batch');
  await as(U,'select set_my_data_prefs(false,$1)',['5y']);
});
await test('choosing "keep until I delete" stops warnings; a pending push is closed unsent',async()=>{
  await reset();await setRet(U,'1y');await msg('364 days');
  await svc('select * from claim_retention_warnings()');const w=await claimPush();assert.equal(w.length,1);
  await setRet(U,'unlimited');assert.equal(await prepare(w[0]),null,'no push once they chose keep-forever');
  assert.equal((await svc('select * from claim_retention_warnings()')).length,0);
});
await test('push payload: only the flag; no message, name, conversation or count; lang for the text',async()=>{
  await reset();await setRet(U,'1y');await msg('364 days');await svc('select * from claim_retention_warnings()');
  const w=await claimPush();assert.equal(w.length,1);const p=await prepare(w[0]);
  assert.deepEqual(p.ret,true);assert.ok(!('who' in p)&&!('accept' in p));
  for(const key of Object.keys(p))assert.ok(['endpoint','keys','binding','lang','ret','prepared_at','expires_at'].includes(key),key);
  assert.ok(!JSON.stringify(p).includes('Synthetic body'));assert.ok(!JSON.stringify(p).includes(conv));
  const h=await svc('select handoff_push($1,$2,$3,$4) h',[w[0].job_id,w[0].subscription_id,w[0].lease,'a'.repeat(64)]);assert.ok(h[0].h?.id,'handoff granted');
});
await test('receive times: the notice waits for the global window; mute of a chat does not stop it',async()=>{
  await reset();await setRet(U,'1y');await msg('364 days');
  await as(U,"select set_my_conversation_mute($1,'always')",[conv]);
  await svc('select * from claim_retention_warnings()');let w=await claimPush();assert.equal(w.length,1,'chat mute does not apply to an account notice');
  assert.ok(await prepare(w[0]));await as(U,'select clear_my_conversation_mute($1)',[conv]);
  await reset();await setRet(U,'1y');await msg('364 days');
  const s=(await as(U,'select get_my_receive_settings(null) s'))[0].s;
  await as(U,"select save_my_receive_settings($1,$3::jsonb,'fixed','UTC',null,$2)",[true,s.revision,closedWindows()]);
  await svc('select * from claim_retention_warnings()');assert.equal((await claimPush()).length,0,'outside the window: queued, not sent');
  assert.equal((await jobs())[0].completed_at,null);
  await windowsOff();assert.equal((await claimPush()).length,1,'window open');
});
await test('release after a failed mail: claim and unsent push are undone so the next run retries',async()=>{
  await reset();await setRet(U,'1y');await msg('364 days');await svc('select * from claim_retention_warnings()');
  await svc('select release_retention_warning($1)',[U]);
  assert.equal((await jobs()).length,0);assert.equal((await query('select retention_warned_at from user_privacy where user_id=$1',[U]))[0].retention_warned_at,null);
  assert.equal((await svc('select * from claim_retention_warnings()')).length,1);
});
await test('only the service role may run any of this',async()=>{
  for(const q of ['select * from claim_retention_warnings()','select release_retention_warning(auth.uid())','select retention_has_expiring(auth.uid())'])
    await assert.rejects(as(U,q),/permission|denied/);
  await assert.rejects(query('select 1').then(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from claim_retention_warnings()');})),/permission|denied/);
});
await test('shortened choice is still honoured: with a 1y limit old messages stay hidden and unlimited member keeps the row',async()=>{
  await reset();await setRet(U,'1y');await setRet(V,'unlimited');const id=await msg('2 years');
  assert.equal((await as(U,'select count(*)::int n from get_messages($1)',[conv]))[0].n,0);
  await svc('select retention_sweep()');assert.equal((await query('select count(*)::int n from messages where id=$1',[id]))[0].n,1);
  await setRet(V,'1y');await svc('select retention_sweep()');assert.equal((await query('select count(*)::int n from messages where id=$1',[id]))[0].n,0);
});
console.log(`keep-messages: ${pass} passed`);
