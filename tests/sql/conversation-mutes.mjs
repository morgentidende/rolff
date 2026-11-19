// Per-conversation mute ("Lydløs"): owner-only storage, push dispatch skip, no effect on delivery.
// Synthetic data only. PGlite by default; PostgreSQL only through the guarded CI bootstrap.
import assert from 'node:assert/strict';
import {bootstrap} from './timezone-test-db.mjs';
import {notificationFixture} from './notification-fixtures.mjs';
if(process.env.TIMEZONE_SQL_BACKEND && process.env.TIMEZONE_SQL_BACKEND!=='postgres')throw Error('Unsupported synthetic SQL backend');
const {db,U,V}=await bootstrap();let pass=0;
const test=async(name,f)=>{await f();pass++;console.log('ok',name);};
const query=async(sql,p=[])=>(await db.query(sql,p)).rows;
const as=async(uid,sql,p=[])=>db.transaction(async tx=>{await tx.exec(`set local role authenticated;select set_config('request.jwt.sub','${uid}',true)`);return (await tx.query(sql,p)).rows;});
const svc=async(sql,p=[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return(await tx.query(sql,p)).rows;});
const pub='B'+'A'.repeat(86),auth='A'.repeat(22),endpoint='https://fcm.googleapis.com/fcm/send/SyntheticOnly';
const claim=()=>svc('select * from claim_push_work()');
const prepare=async w=>(await svc('select prepare_push($1,$2,$3) s',[w.job_id,w.subscription_id,w.lease]))[0].s;
const mute=(u,c,d)=>as(u,'select set_my_conversation_mute($1,$2) r',[c,d]);
const mutes=async u=>as(u,'select * from my_conversation_mutes()');
const jobs=async()=>(await query('select count(*)::int n from notification_jobs'))[0].n;

await query('update push_runtime set enabled=true,vapid_public_key=$1',[pub]);
await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);
const f=await notificationFixture(db,V,U);const f2=await notificationFixture(db,V,U);
const conv=f.conv,conv2=f2.conv;
const [X]=(await query("insert into auth.users(email) values ('mute-outsider@example.invalid') returning id")).map(r=>r.id);
const open=async()=>{await f.window(false);await f2.window(false);}; // receive times off = always in window
// Earlier deliveries are aged so the job's 1-second release slack only sees the message under test.
const fresh=async()=>{await query('delete from notification_jobs');await query('delete from push_attempts');await query("update message_deliveries set released_at=released_at-interval '1 minute' where released_at is not null");};

await test('table is RLS-protected and clients have no write grants',async()=>{
  const r=await query("select relrowsecurity from pg_class where relname='conversation_mutes'");assert.equal(r[0].relrowsecurity,true);
  await assert.rejects(as(U,'insert into conversation_mutes(user_id,conversation_id) values($1,$2)',[U,conv]),/permission denied/);
  await assert.rejects(as(U,'update conversation_mutes set mute_until=null'),/permission denied/);
  await assert.rejects(as(U,'delete from conversation_mutes'),/permission denied/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from conversation_mutes');}),/permission denied/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from my_conversation_mutes()');}),/permission denied/);
});
await test('background helpers are denied to clients',async()=>{
  for(const sql of ['select conversation_is_muted(gen_random_uuid(),gen_random_uuid(),now())','select notification_job_all_muted(gen_random_uuid(),1,now())'])await assert.rejects(as(U,sql),/permission denied/);
});
await test('8 hours, 24 hours, 1 week and always are stored with the server clock',async()=>{
  for(const [d,h] of [['8h',8],['24h',24],['1w',168]]){
    const r=(await mute(U,conv,d))[0].r;assert.equal(r.muted,true);assert.equal(r.always,false);
    const ms=Date.parse(r.mute_until)-Date.now();assert(Math.abs(ms-h*3600e3)<60e3,`${d} ${ms}`);
    const m=(await mutes(U));assert.equal(m.length,1);assert.equal(m[0].always,false);
  }
  const r=(await mute(U,conv,'always'))[0].r;assert.equal(r.always,true);assert.equal(r.mute_until,null);
  const m=await mutes(U);assert.equal(m.length,1);assert.equal(m[0].always,true);assert.equal(m[0].mute_until,null);
  assert.equal((await query('select count(*)::int n from conversation_mutes'))[0].n,1,'one row per user and conversation');
});
await test('invalid duration, anonymous and non-members are rejected',async()=>{
  await assert.rejects(mute(U,conv,'forever'),/invalid_duration/);await assert.rejects(mute(U,conv,null),/invalid_duration/);
  await assert.rejects(mute(X,conv,'8h'),/not_member/);await assert.rejects(as('','select * from my_conversation_mutes()'),/unauthenticated/);
});
await test('the other participant cannot see or change the mute',async()=>{
  assert.equal((await mutes(V)).length,0);
  assert.equal((await as(V,'select * from conversation_mutes')).length,0,'RLS hides the other user rows');
  assert.equal((await as(V,'select * from conversation_mutes where user_id=$1',[U])).length,0);
  await as(V,'select clear_my_conversation_mute($1)',[conv]);
  assert.equal((await mutes(U)).length,1,'clearing as the other user does not touch the owner mute');
  await mute(V,conv,'8h');assert.equal((await mutes(U)).length,1);assert.equal((await mutes(U))[0].always,true);
  await as(V,'select clear_my_conversation_mute($1)',[conv]);
  // Nothing the other party can call (list, members, receive state) exposes it.
  for(const sql of ['select to_jsonb(l) j from list_my_conversations() l','select to_jsonb(l) j from list_my_conversations_v2() l'])assert(!/mute/i.test(JSON.stringify(await as(V,sql))));
});
await test('muted conversation never creates a push job, but the message is still delivered',async()=>{
  await open();await fresh();
  const M=await f.message();await svc('select push_release_tick()');
  assert((await query('select released_at from message_deliveries where message_id=$1',[M]))[0].released_at);
  assert.equal(await jobs(),0);assert.equal((await claim()).length,0);
  assert.equal((await query('select count(*)::int n from message_deliveries where message_id=$1 and recipient_id=$2 and released_at is not null',[M,U]))[0].n,1);
});
await test('mute does not change receive times: a held message stays held and releases at its normal time',async()=>{
  await fresh();await f.window(true);const M=await f.message();
  assert.equal((await svc('select push_release_tick() n'))[0].n,0);
  assert.equal((await query('select released_at from message_deliveries where message_id=$1',[M]))[0].released_at,null);
  await f.window(false);assert.equal((await svc('select push_release_tick() n'))[0].n,1);
  assert((await query('select released_at from message_deliveries where message_id=$1',[M]))[0].released_at);assert.equal(await jobs(),0);
});
await test('an unmuted conversation still notifies while the other is muted',async()=>{
  await fresh();await open();await f2.message();await svc('select push_release_tick()');
  const w=await claim();assert.equal(w.length,1);assert(await prepare(w[0]));
});
await test('expired mute notifies again; infinity behaves as always',async()=>{
  await fresh();await query("update conversation_mutes set mute_until=clock_timestamp()-interval '1 second' where user_id=$1 and conversation_id=$2",[U,conv]);
  await f.message();await svc('select push_release_tick()');assert.equal((await mutes(U)).length,0,'expired mute is hidden');
  assert.equal((await claim()).length,1);
  await fresh();await query("update conversation_mutes set mute_until='infinity' where user_id=$1 and conversation_id=$2",[U,conv]);
  assert.equal((await mutes(U))[0].always,true);assert.equal((await mutes(U))[0].mute_until,null);
  await f.message();await svc('select push_release_tick()');assert.equal(await jobs(),0);
});
await test('muting after release but before dispatch closes the job; later unmute never fires it',async()=>{
  await fresh();await clear();await f.message();await svc('select push_release_tick()');assert.equal(await jobs(),1);
  await mute(U,conv,'8h');assert.equal((await claim()).length,0);
  assert((await query('select completed_at from notification_jobs'))[0].completed_at,'job closed without a push');
  await as(U,'select clear_my_conversation_mute($1)',[conv]);assert.equal((await claim()).length,0,'no late push after unmute');
});
await test('mute after claim but before handoff blocks the prepared push',async()=>{
  await fresh();await clear();await f.message();await svc('select push_release_tick()');
  const w=(await claim())[0];assert(await prepare(w));
  await mute(U,conv,'24h');assert.equal(await prepare(w),null);
  assert.equal((await svc('select handoff_push($1,$2,$3,$4) s',[w.job_id,w.subscription_id,w.lease,'a'.repeat(64)]))[0].s,null);
});
await test('a release mixing muted and unmuted conversations still sends one neutral push',async()=>{
  await fresh();await clear();await mute(U,conv,'always');await f.message();await f2.message();await svc('select push_release_tick()');
  assert.equal(await jobs(),1);const w=await claim();assert.equal(w.length,1);assert(await prepare(w[0]));
});
await test('push payload stays neutral: no conversation, sender id or mute data',async()=>{
  await fresh();await clear();await f.message();await svc('select push_release_tick()');const p=await prepare((await claim())[0]);
  assert.deepEqual(Object.keys(p).sort(),['binding','endpoint','expires_at','keys','lang','prepared_at','who']);
});
await test('clearing a mute removes it for the owner only; leaving/deleting cascades',async()=>{
  await mute(U,conv,'always');await mute(V,conv,'8h');await as(U,'select clear_my_conversation_mute($1)',[conv]);
  assert.equal((await mutes(U)).length,0);assert.equal((await mutes(V)).length,1);
  await query('delete from conversation_mutes');
  await mute(U,conv2,'8h');await query('delete from conversations where id=$1',[conv2]);assert.equal((await query('select count(*)::int n from conversation_mutes'))[0].n,0);
});
async function clear(){await query('delete from conversation_mutes where user_id=$1',[U]);}
console.log(JSON.stringify({pass,fail:0,backend:process.env.TIMEZONE_SQL_BACKEND==='postgres'?'PostgreSQL':'pglite',network:'none',realContent:false}));await db.close();
