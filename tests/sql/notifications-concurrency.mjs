// Real parallel tests require guarded disposable PostgreSQL CI, never an existing user/prod database.
// Reuses the strict loopback + synthetic DB/user + explicit CI guard, no external traffic.
import assert from 'node:assert/strict';
import {bootstrap,connectPG} from './timezone-test-db.mjs';
import {notificationFixture,closedWindows} from './notification-fixtures.mjs';
if(process.env.TIMEZONE_SQL_BACKEND!=='postgres')throw Error('Requires guarded disposable PostgreSQL CI');
const {db,U,V}=await bootstrap(),clients=[];
const client=async()=>{const c=await connectPG();clients.push(c);return c;};
const auth=async(c,u)=>{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.sub',$1,true)",[u]);};
const pub='B'+'A'.repeat(86),endpoint='https://fcm.googleapis.com/fcm/send/SyntheticOnly';
const fixture=await notificationFixture(db,V,U);const seed=fixture.message;
async function handoff(conn,w){return (await conn.query('select handoff_push($1,$2,$3,$4) p',[w.job_id,w.subscription_id,w.lease,'a'.repeat(64)])).rows[0].p;}
async function prepare(conn,w){return (await conn.query('select prepare_push($1,$2,$3) p',[w.job_id,w.subscription_id,w.lease])).rows[0].p;}
let pass=0;const test=async(n,f)=>{await f();pass++;console.log('ok',n);};
try{
 await db.query('update push_runtime set enabled=true,vapid_public_key=$1',[pub]);
 await db.transaction(async tx=>{await tx.query('set local role authenticated');await tx.query("select set_config('request.jwt.sub',$1,true)",[U]);await tx.query('select save_my_push($1,$2,$3)',[endpoint,pub,'A'.repeat(22)]);});
 await fixture.window(false);
 let work;
 await test('parallel claims SKIP LOCKED, no duplicate attempt lease',async()=>{
  await seed();await db.query('select push_release_tick()');const a=await client(),b=await client();await a.query('begin');await b.query('begin');
  const first=(await a.query('select * from claim_push_work()')).rows;assert.equal(first.length,1);work=first[0];
  await b.query("set local statement_timeout='1500ms'");assert.equal((await b.query('select * from claim_push_work()')).rows.length,0);await b.query('commit');await a.query('commit');
 });
 await test('claimed dispatch defers under uncommitted receive-settings writer, then sees new closed window',async()=>{
  const writer=await client(),reader=await client();await auth(writer,U);await writer.query("select save_my_receive_settings(true,$1::jsonb,'fixed','UTC',null,1)",[closedWindows()]);await reader.query("set statement_timeout='1500ms'");assert.equal(await prepare(reader,work),null);assert.equal(await handoff(reader,work),null);await writer.query('commit');assert.equal(await prepare(reader,work),null);assert.equal(await handoff(reader,work),null);
 });
 await test('normal scheduler never force releases while receive settings locked',async()=>{
  const m=await seed(),writer=await client(),worker=await client();await auth(writer,U);await writer.query("select save_my_receive_settings(false,'[]','fixed','UTC',null,2)");await worker.query("set statement_timeout='1500ms'");await worker.query('select push_release_tick()');assert.equal((await db.query('select released_at from message_deliveries where message_id=$1',[m])).rows[0].released_at,null);await writer.query('rollback');
 });
 await fixture.window(false);
 await test('prepare sees opt-out contention, never waits or leaks capabilities',async()=>{
  const writer=await client(),reader=await client();await auth(writer,U);await writer.query('select revoke_my_push(null,true)');await reader.query("set statement_timeout='1500ms'");assert.equal(await prepare(reader,work),null);assert.equal(await handoff(reader,work),null);await writer.query('rollback');assert((await prepare(reader,work)).endpoint===endpoint);
 });
 await test('expired lease reclaimed by one contender; old token rejected',async()=>{
  await db.query("update push_attempts set lease_until=clock_timestamp()-interval '1 second',next_at=clock_timestamp()-interval '1 second'");const a=await client(),b=await client();const [one,two]=await Promise.all([a.query('select * from claim_push_work()'),b.query('select * from claim_push_work()')]);const all=[...one.rows,...two.rows];assert.equal(all.length,1);assert.notEqual(all[0].lease,work.lease);assert.equal(await prepare(a,work),null);
 });

 async function fresh(){await db.query('delete from notification_jobs');await db.query('delete from push_subscriptions');await fixture.window(false);await db.transaction(async tx=>{await tx.query('set local role authenticated');await tx.query("select set_config('request.jwt.sub',$1,true)",[U]);await tx.query('select save_my_push($1,$2,$3)',[endpoint,pub,'A'.repeat(22)]);});await seed();await db.query('select push_release_tick()');return (await db.query('select * from claim_push_work()')).rows[0];}
 // Obtain PIDs BEFORE sending a blocking request (one query at a time per connection).
 async function waitEdge(waiterPid,holderPid){const until=Date.now()+3000;while(Date.now()<until){if((await db.query('select $2::int=any(pg_blocking_pids($1::int)) b',[waiterPid,holderPid])).rows[0].b)return;await new Promise(setImmediate);}throw Error('Expected real lock edge not observed');}
 const reflect=p=>p.then(value=>({value}),error=>({error}));
 await test('two finalizers for one lease: one committed intent, no replay',async()=>{
  work=await fresh();const a=await client(),b=await client();await a.query('begin');await b.query('begin');const first=await handoff(a,work);assert(first);await b.query("set local statement_timeout='1500ms'");assert.equal(await handoff(b,work),null);await a.query('commit');await b.query('commit');assert.equal(await handoff(b,work),null);assert.equal(Number((await db.query('select count(*) n from push_handoffs')).rows[0].n),1);
 });
 await test('intent-first serializes settings writer after the point, intent is not marked sent',async()=>{
  work=await fresh();const a=await client(),writer=await client();const ap=(await a.query('select pg_backend_pid() p')).rows[0].p,wp=(await writer.query('select pg_backend_pid() p')).rows[0].p;
  await a.query('begin');assert(await handoff(a,work));await auth(writer,U);const rev=(await db.query('select timezone_revision r from receive_settings where user_id=$1',[U])).rows[0].r;
  const pending=reflect(writer.query("select save_my_receive_settings(true,$2::jsonb,'fixed','UTC',null,$1)",[rev,closedWindows()]));await waitEdge(wp,ap);await a.query('commit');const result=await pending;if(result.error)throw result.error;await writer.query('commit');assert.equal((await db.query('select outcome from push_handoffs')).rows[0].outcome,'intent');assert.equal((await db.query('select sent_at from notification_jobs')).rows[0].sent_at,null);assert.equal((await db.query('select in_receive_window($1) x',[U])).rows[0].x,false);
 });
 await test('intent-first serializes opt-out, retaining only explicit already-in-flight intent',async()=>{
  work=await fresh();const a=await client(),writer=await client();const ap=(await a.query('select pg_backend_pid() p')).rows[0].p,wp=(await writer.query('select pg_backend_pid() p')).rows[0].p;
  await a.query('begin');const h=await handoff(a,work);assert(h);await auth(writer,U);const pending=reflect(writer.query('select revoke_my_push(null,true)'));await waitEdge(wp,ap);await a.query('commit');const result=await pending;if(result.error)throw result.error;await writer.query('commit');assert.equal((await db.query('select id from push_handoffs')).rows[0].id,h.id);assert.equal((await db.query('select count(*) n from push_subscriptions')).rows[0].n,'0');assert.equal(await handoff(a,work),null);
 });
 await test('opt-out-first prevents final authorization while uncommitted and after commit',async()=>{
  work=await fresh();const writer=await client(),reader=await client();await auth(writer,U);await writer.query('select revoke_my_push(null,true)');await reader.query("set statement_timeout='1500ms'");assert.equal(await handoff(reader,work),null);await writer.query('commit');assert.equal(await handoff(reader,work),null);assert.equal(Number((await db.query('select count(*) n from push_handoffs')).rows[0].n),0);
 });
 console.log(JSON.stringify({pass,backend:'PostgreSQL',network:'guarded loopback synthetic database only'}));
}finally{await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));await db.close();}
