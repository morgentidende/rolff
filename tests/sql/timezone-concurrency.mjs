// Synthetic functionality tests only; not a security review.
import assert from 'node:assert/strict';
import {bootstrap,connectPG} from './timezone-test-db.mjs';
const {db,U,V}=await bootstrap();
const D='10000000-0000-4000-8000-000000000001';
const OPEN=Array.from({length:7},(_,i)=>({weekday:i+1,start_minute:0,end_minute:1440}));
const CLOSED=[{weekday:1,start_minute:0,end_minute:1}]; // nearly always outside the window
const clients=[];
async function client(){const c=await connectPG();clients.push(c);c.pid=(await c.query('select pg_backend_pid() p')).rows[0].p;return c;}
async function begin(c,u){await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.sub',$1,true)",[u]);}
async function save(c,u,rev,windows=OPEN){return (await c.query('select save_my_receive_settings(true,$1::jsonb,\'auto\',\'Europe/Copenhagen\',$2,$3,false) r',[JSON.stringify(windows),D,rev])).rows[0].r;}
async function get(u){return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.sub',$1,true)",[u]);return (await tx.query('select get_my_receive_settings($1) r',[D])).rows[0].r;});}
async function reset(u,windows=OPEN){const c=await client();try{await begin(c,u);const r=await get(u);await save(c,u,r.revision,windows);await c.query('commit');}finally{await c.query('rollback');}}
// Poll actual lock graph, not timing guesses. All waits have hard deadlines.
async function waitBlocked(waiter,holder){const until=Date.now()+3500;while(Date.now()<until){const r=await db.query('select $2::int=any(pg_blocking_pids($1::int)) b',[waiter.pid,holder.pid]);if(r.rows[0].b)return;await new Promise(setImmediate);}throw Error('Expected lock wait not observed');}
const reflected=p=>p.then(value=>({value}),error=>({error}));
async function ok(p){const r=await p;if(r.error)throw r.error;return r.value;}
async function release(c,u){return c.query('select _release_for($1,false) n',[u]);}
async function seed(u){const conv=(await db.query('insert into conversations(created_by) values($1) returning id',[u])).rows[0].id;const m=(await db.query("insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key) values($1,$2,'Fabricated delivery check','synthetic',gen_random_uuid()::text) returning id",[conv,u])).rows[0].id;await db.query('insert into message_deliveries(message_id,recipient_id) values($1,$2)',[m,u]);return m;}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('ok',name);}
try{
 await reset(U);await reset(V);
 await test('same revision parallel sync: one success, one conflict',async()=>{
  const a=await client(),b=await client();const r=await get(U);await begin(a,U);await begin(b,U);
  await a.query('select sync_my_receive_timezone($1,$2,$3)',['Europe/London',D,r.revision]);
  const pending=reflected(b.query('select sync_my_receive_timezone($1,$2,$3)',['UTC',D,r.revision]));
  await waitBlocked(b,a);await a.query('commit');const loser=await pending;assert.match(loser.error?.message||'',/settings_conflict/);await b.query('rollback');assert.equal((await get(U)).revision,r.revision+1);
 });
 await reset(U);
 await test('normal release defers immediately during exclusive save, then sees closed window',async()=>{
  const m=await seed(U),a=await client(),b=await client(),r=await get(U);
  const jobs=Number((await db.query('select count(*) n from notification_jobs where user_id=$1',[U])).rows[0].n);
  await begin(a,U);await save(a,U,r.revision,CLOSED);await b.query('begin');
  // Writer remains uncommitted throughout. Old blocking implementation must time out/fail.
  await b.query("set local statement_timeout='1500ms'");
  assert.equal((await release(b,U)).rows[0].n,0);await b.query('commit');
  assert.equal((await db.query('select released_at from message_deliveries where message_id=$1',[m])).rows[0].released_at,null);
  assert.equal(Number((await db.query('select count(*) n from notification_jobs where user_id=$1',[U])).rows[0].n),jobs);
  await a.query('commit');
  assert.equal((await release(b,U)).rows[0].n,0);
  assert.equal((await db.query('select released_at from message_deliveries where message_id=$1',[m])).rows[0].released_at,null);
 });
 await reset(U);
 await test('actual release shared lock blocks exclusive save until commit',async()=>{
  const a=await client(),b=await client(),r=await get(U);await a.query('begin');await release(a,U);await begin(b,U);
  const pending=reflected(save(b,U,r.revision,CLOSED));await waitBlocked(b,a);await a.query('commit');await ok(pending);await b.query('commit');assert.deepEqual((await get(U)).windows,CLOSED);
 });
 await test('independent user update completes while first user lock held',async()=>{
  const a=await client(),b=await client(),u=await get(U),v=await get(V);await begin(a,U);await save(a,U,u.revision,CLOSED);await begin(b,V);await b.query("set local statement_timeout='1500ms'");await save(b,V,v.revision,CLOSED);await b.query('commit');assert.equal((await get(V)).revision,v.revision+1);await a.query('rollback');
 });
 await reset(U);await reset(V);
 await test('reverse multi-recipient shared releases and queued per-user saves finish',async()=>{
  const a=await client(),b=await client(),su=await client(),sv=await client();const u=await get(U),v=await get(V);
  await a.query('begin');await b.query('begin');await release(a,U);await release(b,V);
  await begin(su,U);await begin(sv,V);
  const pu=reflected(save(su,U,u.revision,CLOSED)),pv=reflected(save(sv,V,v.revision,CLOSED));await waitBlocked(su,a);await waitBlocked(sv,b);
  const pa=reflected(release(a,V)),pb=reflected(release(b,U));
  // Normal release must finish (either acquire compatible shared lock or defer 0).
  // A blocking-lock regression/deadlock must FAIL, never suppress it or stub locks.
  await Promise.all([ok(pa).then(()=>a.query('commit')),ok(pb).then(()=>b.query('commit'))]);
  await Promise.all([ok(pu).then(()=>su.query('commit')),ok(pv).then(()=>sv.query('commit'))]);
  assert.deepEqual((await get(U)).windows,CLOSED);assert.deepEqual((await get(V)).windows,CLOSED);
 });
 await test('explicit single-recipient forced receive waits, then releases outside closed window',async()=>{
  const m=await seed(U),a=await client(),b=await client(),r=await get(U);
  await begin(a,U);await save(a,U,r.revision,CLOSED);await b.query('begin');
  const pending=reflected(b.query('select _release_for($1,true) n',[U]));
  await waitBlocked(b,a);await a.query('commit');assert.ok((await ok(pending)).rows[0].n>=1);await b.query('commit');
  assert.notEqual((await db.query('select released_at from message_deliveries where message_id=$1',[m])).rows[0].released_at,null);
 });
 console.log(JSON.stringify({passed,backend:'PostgreSQL',locks:'real parallel connections'}));
}finally{
 // Roll back all outstanding work first so shutdown cannot wait on held locks.
 await Promise.allSettled(clients.map(c=>c.query('rollback')));
 await Promise.allSettled(clients.map(c=>c.end()));await db.close();
}
