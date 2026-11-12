import assert from 'node:assert/strict';
import {bootstrap} from './timezone-test-db.mjs';
import {notificationFixture} from './notification-fixtures.mjs';
const {db,U,V}=await bootstrap();const f=await notificationFixture(db,V,U);
let pass=0,fail=0;
async function test(name,fn){try{await fn();console.log('ok',name);pass++;}catch(e){console.error('not ok',name,e);fail++;}}
const scalar=async sql=>(await db.query(sql)).rows[0].n;
const empty=async()=>{for(const table of ['messages','message_deliveries','notification_jobs'])assert.equal(Number(await scalar(`select count(*) n from ${table}`)),0);};
const body='En neutral praktisk aftale';
await test('actual owner lists private; service snapshot and v3 issuer remain server-only',async()=>{
 await f.owner(U,'select add_blocked_word($1,$2,true)',[f.conv,'cykel']);
 await f.owner(U,'select add_blocked_topic($1,$2)',[f.conv,'Privat syntetisk emne']);
 const s=await f.snapshot();assert.ok(s.words.includes('cykel'));assert.ok(s.topics.includes('Privat syntetisk emne'));
 assert.equal((await f.owner(V,'select * from conversation_blocked_topics where conversation_id=$1',[f.conv])).length,0);
 await assert.rejects(f.owner(U,"select issue_reply_approval_v3($1,$2,$3,'synthetic','mock',$4,null)",[V,f.conv,await f.digest(body),s.revision]),/permission denied/);
});
await test('owner edit between evaluation and v3 issuance prevents message, delivery and job',async()=>{
 const s=await f.snapshot();await f.owner(U,'select add_blocked_word($1,$2,true)',[f.conv,'lastbil']);
 await assert.rejects(f.issue(body,s.revision),/recipient_policy_changed/);await empty();
});
await test('owner topic edit between v3 issuance and consume prevents message and notification',async()=>{
 const id=await f.issue(body,(await f.snapshot()).revision);
 await f.owner(U,'select add_blocked_topic($1,$2)',[f.conv,'Endnu et privat emne']);
 await assert.rejects(f.commit(id,body,'synthetic-stale'),/recipient_policy_changed/);await empty();
});
await test('legacy v2 ticket cannot bypass v3 consumption gate or create notification work',async()=>{
 const id=(await f.service("select issue_reply_approval_v2($1,$2,$3,'synthetic','mock',null) id",[V,f.conv,await f.digest(body)]))[0].id;
 await assert.rejects(f.commit(id,body,'synthetic-legacy'),/recipient_policy_changed|approval_policy/);await empty();
});
let mid,job;
await test('current v3 real-owner send stays pending; owner settings save has no release side effect; normal tick authorizes generic one-use intent',async()=>{
 await f.window(true);
 await db.query("update push_runtime set enabled=true,vapid_public_key=$1",['B'+'A'.repeat(86)]);
 await f.owner(U,'select save_my_push($1,$2,$3,null)', ['https://fcm.googleapis.com/fcm/send/SyntheticIntegration','B'+'A'.repeat(86),'A'.repeat(22)]);
 mid=await f.message();assert.equal(Number(await scalar('select count(*) n from notification_jobs')),0);
 assert.equal((await db.query('select released_at from message_deliveries where message_id=$1',[mid])).rows[0].released_at,null);
 await f.window(false);assert.equal(Number(await scalar('select count(*) n from notification_jobs')),0);
 await f.service('select push_release_tick()');job=(await f.service('select * from claim_push_work()'))[0];assert.ok(job);
 const prepared=(await f.service('select prepare_push($1,$2,$3) s',[job.job_id,job.subscription_id,job.lease]))[0].s;assert.ok(prepared);
 const intent=(await f.service('select handoff_push($1,$2,$3,$4) s',[job.job_id,job.subscription_id,job.lease,'e'.repeat(64)]))[0].s;assert.ok(intent);assert.ok(intent.valid_for_ms<=750);
 assert.doesNotMatch(JSON.stringify(intent),/cykel|lastbil|Privat|En neutral|sender|conversation|body/i);
});
await test('policy change after committed message does not duplicate delivery or notification on idempotent retry',async()=>{
 const text='Anden neutral aftale';const id=await f.issue(text,(await f.snapshot()).revision);const first=await f.commit(id,text,'synthetic-idempotent');
 await f.owner(U,'select add_blocked_word($1,$2,true)',[f.conv,'trailer']);
 const counts=await db.query('select (select count(*) from messages) m,(select count(*) from message_deliveries) d,(select count(*) from notification_jobs) j');
 const repeated=await f.commit(id,text,'synthetic-idempotent');assert.equal(repeated.message_id,first.message_id);
 assert.deepEqual((await db.query('select (select count(*) from messages) m,(select count(*) from message_deliveries) d,(select count(*) from notification_jobs) j')).rows,counts.rows);
});
console.log(JSON.stringify({pass,fail,backend:process.env.TIMEZONE_SQL_BACKEND||'pglite',network:'none',realContent:false}));await db.close();process.exitCode=fail?1:0;
