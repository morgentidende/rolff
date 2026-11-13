import assert from 'node:assert/strict';
import {bootstrap} from './timezone-test-db.mjs';
const {db,U,V}=await bootstrap();
let pass=0, fail=0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, '-', e.message); } }
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.sub', '${uid}', true);`);
    return (await tx.query(sql, params)).rows;
  });
}
async function rejects(p, re) { await assert.rejects(p, re); }
const D='10000000-0000-4000-8000-000000000001';
const closed=[{weekday:1,start_minute:0,end_minute:1}];
const open=[{weekday:1,start_minute:0,end_minute:1440},{weekday:2,start_minute:0,end_minute:1440},{weekday:3,start_minute:0,end_minute:1440},{weekday:4,start_minute:0,end_minute:1440},{weekday:5,start_minute:0,end_minute:1440},{weekday:6,start_minute:0,end_minute:1440},{weekday:7,start_minute:0,end_minute:1440}];
// Tuesday 10 Nov 2026 12:00 UTC — outside the 1-minute Monday closed window.
const TUE='2026-11-10 12:00:00+00';

async function conv() {
  const id=(await db.query('insert into conversations(created_by) values($1) returning id',[U])).rows[0].id;
  await db.query("insert into memberships(conversation_id,user_id,role) values($1,$2,'parent'),($1,$3,'parent')",[id,U,V]);
  return id;
}
async function hold(recipient, conversation, body='Fabricated per-chat window') {
  const m=(await db.query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key) values($1,$2,$3,'synthetic',$4) returning id`,
    [conversation, recipient===U?V:U, body, 'k-'+crypto.randomUUID()])).rows[0].id;
  await db.query('insert into message_deliveries(message_id,recipient_id) values($1,$2)',[m,recipient]);
  return m;
}
const get=async(u,c,d=D)=>(await as(u,'select get_my_conversation_receive_settings($1,$2) r',[c,d]))[0].r;
const save=async(u,c,rev,windows,enabled=true,mode='fixed',zone='UTC',device=D)=>(await as(u,'select save_my_conversation_receive_settings($1,$2,$3::jsonb,$4,$5,$6,$7,false) r',[c,enabled,JSON.stringify(windows),mode,zone,device,rev]))[0].r;

const A=await conv();
const B=await conv();

await t('new conversation without a template is unconfigured and always receives', async () => {
  const r=await get(U,A);
  assert.equal(r.configured,false);
  assert.equal(r.revision,0);
  assert.equal((await db.query('select in_receive_window($1,clock_timestamp(),$2) v',[U,A])).rows[0].v,true);
});

await t('unauthenticated and non-member rejected', async () => {
  await rejects(as('','select get_my_conversation_receive_settings($1,$2)',[A,D]),/unauthenticated/);
  const stranger=(await db.query(`insert into auth.users(raw_user_meta_data) values ('{"display_name":"Fabricated stranger"}') returning id`)).rows[0].id;
  await rejects(as(stranger,'select get_my_conversation_receive_settings($1,$2)',[A,D]),/not_member/);
});

await t('saving times on A does not change B, and becomes the template for a new chat', async () => {
  const ra=await save(U,A,0,closed,true);
  assert.equal(ra.configured,true);
  assert.equal(ra.enabled,true);
  assert.deepEqual(ra.windows,closed);
  const rb=await get(U,B);
  assert.equal(rb.configured,false);
  // No row of B's own, so delivery falls back to the just-written global template.
  assert.equal((await db.query('select in_receive_window($1,$2::timestamptz,$3) v',[U,TUE,B])).rows[0].v,false);
  assert.equal((await db.query('select in_receive_window($1,$2::timestamptz) v',[U,TUE])).rows[0].v,false);
  const C=await conv();
  const rc=await get(U,C);
  assert.equal(rc.configured,true);
  assert.deepEqual(rc.windows,closed);
  assert.equal((await db.query('select in_receive_window($1,$2::timestamptz,$3) v',[U,TUE,C])).rows[0].v,false);
});

await t('messages are released only in conversations that are in window', async () => {
  await save(U,B,(await get(U,B)).revision,open,true);
  const mA=await hold(U,A);
  const mB=await hold(U,B);
  assert.equal((await db.query('select _release_for($1,false) n',[U])).rows[0].n,1);
  assert.equal((await db.query('select released_at is not null r from message_deliveries where message_id=$1',[mA])).rows[0].r,false);
  assert.equal((await db.query('select released_at is not null r from message_deliveries where message_id=$1',[mB])).rows[0].r,true);
});

await t('pending count and receive_now are per conversation', async () => {
  const mA=await hold(U,A);
  const mB=await hold(U,B);
  // B is open, so a normal release would free B; hold B by closing it first? B is still open from previous test.
  // Count pending including ones already waiting on A plus new holds. Force-release only A.
  const beforeA=(await as(U,'select my_pending_count($1) n',[A]))[0].n;
  const beforeB=(await as(U,'select my_pending_count($1) n',[B]))[0].n;
  const beforeAll=(await as(U,'select my_pending_count(null) n'))[0].n;
  assert.ok(beforeA>=2);
  assert.ok(beforeAll>=beforeA+beforeB);
  const released=(await as(U,'select receive_now($1) n',[A]))[0].n;
  assert.equal(released,beforeA);
  assert.equal((await as(U,'select my_pending_count($1) n',[A]))[0].n,0);
  assert.equal((await as(U,'select my_pending_count($1) n',[B]))[0].n,beforeB);
  assert.equal((await db.query('select released_at is not null r from message_deliveries where message_id=$1',[mA])).rows[0].r,true);
  assert.equal((await db.query('select released_at is not null r from message_deliveries where message_id=$1',[mB])).rows[0].r,beforeB===0);
});

await t('force receive on a closed conversation does not open the push window yet', async () => {
  const jobs=(await db.query('select id from notification_jobs where user_id=$1 order by id desc limit 1',[U])).rows;
  assert.ok(jobs.length);
  // A is closed; the last receive_now(A) created a job. Push must wait.
  assert.equal((await db.query('select notification_in_receive_window($1,clock_timestamp(),$2) v',[U,jobs[0].id])).rows[0].v,false);
  await save(U,A,(await get(U,A)).revision,open,true);
  assert.equal((await db.query('select notification_in_receive_window($1,clock_timestamp(),$2) v',[U,jobs[0].id])).rows[0].v,true);
});

await t('fail-safe: missing per-conversation row uses the global setting', async () => {
  await save(U,A,(await get(U,A)).revision,closed,true);
  const C=await conv();
  assert.equal((await get(U,C)).configured,true);
  await db.query('delete from conversation_receive_windows where user_id=$1 and conversation_id=$2',[U,C]);
  await db.query('delete from conversation_receive_settings where user_id=$1 and conversation_id=$2',[U,C]);
  assert.equal((await get(U,C)).configured,false);
  assert.equal((await db.query('select in_receive_window($1,$2::timestamptz) v',[U,TUE])).rows[0].v,false);
  assert.equal((await db.query('select in_receive_window($1,$2::timestamptz,$3) v',[U,TUE,C])).rows[0].v,false);
});

await t('save of empty enabled windows is rejected; disabled empty is allowed', async () => {
  const r=await get(U,A);
  await rejects(save(U,A,r.revision,[],true),/windows_required/);
  const after=await save(U,A,r.revision,[],false);
  assert.equal(after.enabled,false);
  assert.equal((await db.query('select in_receive_window($1,clock_timestamp(),$2) v',[U,A])).rows[0].v,true);
});

console.log(JSON.stringify({pass,fail,backend:process.env.TIMEZONE_SQL_BACKEND||'pglite'}));
await db.close();
process.exitCode=fail?1:0;
