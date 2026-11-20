// Real parallel tests for the edit-hold: require guarded disposable PostgreSQL CI (synthetic data, loopback only).
import assert from 'node:assert/strict';
import {bootstrap,connectPG} from './timezone-test-db.mjs';
if(process.env.TIMEZONE_SQL_BACKEND!=='postgres')throw Error('Requires guarded disposable PostgreSQL CI');
const {db}=await bootstrap(),clients=[];
const client=async()=>{const c=await connectPG();clients.push(c);return c;};
const auth=async(c,u)=>{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.sub',$1,true)",[u]);};
const reflect=p=>p.then(value=>({value}),error=>({error}));
async function waitEdge(waiterPid,holderPid){const until=Date.now()+3000;while(Date.now()<until){if((await db.query('select $2::int=any(pg_blocking_pids($1::int)) b',[waiterPid,holderPid])).rows[0].b)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected real lock edge not observed');}
const pid=async c=>(await c.query('select pg_backend_pid() p')).rows[0].p;
let pass=0;const test=async(n,f)=>{await f();pass++;console.log('ok',n);};
try{
 const [S,R]=(await db.query(`insert into auth.users(email) values ('hc-s@example.invalid'),('hc-r@example.invalid') returning id`)).rows.map(r=>r.id);
 await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`,[S,R]);
 const as1=async(u,sql,p=[])=>db.transaction(async tx=>{await tx.query('set local role authenticated');await tx.query("select set_config('request.jwt.sub',$1,true)",[u]);return (await tx.query(sql,p)).rows;});
 const conv=(await as1(S,`select create_conversation('Hold race') c`))[0].c;
 const tok=(await as1(S,`select * from create_invitation($1,'parent')`,[conv]))[0].token;await as1(R,`select accept_invitation($1)`,[tok]);
 await as1(S,`select set_delayed_send($1,true)`,[conv]);
 await db.query(`create function public.test_issue_current_approval(p_sender uuid,conv uuid,p_hash text,p_provider text,p_model text,p_reply uuid default null) returns uuid language sql security definer as $$ select public.issue_reply_approval_v3(p_sender,conv,p_hash,p_provider,p_model,public.recipient_filter_snapshot(conv,p_sender)->>'revision',p_reply) $$`);
 const send=async(body,key)=>{const h=(await db.query(`select encode(extensions.digest($1,'sha256'),'hex') h`,[body])).rows[0].h;const a=(await db.query(`select test_issue_current_approval($1,$2,$3,'test','hold',null) id`,[S,conv,h])).rows[0].id;return (await db.query(`select * from commit_message_reply($1,$2,$3,$4,$5,null)`,[a,S,conv,body,key])).rows[0].message_id;};
 const released=async m=>(await db.query(`select count(*)::int n from message_deliveries where message_id=$1 and released_at is not null`,[m])).rows[0].n;

 await test('release in flight wins: hold waits for it, then refuses (no_longer_pending); message was delivered, never "held and delivered"',async()=>{
  const mid=await send('Race A','hc-key-1');await db.query(`update messages set deliver_after=clock_timestamp()+interval '300 milliseconds' where id=$1`,[mid]);
  await new Promise(r=>setTimeout(r,400));
  const rel=await client(),hold=await client();const rp=await pid(rel),hp=await pid(hold);
  await rel.query('begin');assert.equal((await rel.query('select _release_for($1,true) n',[R])).rows[0].n,1);
  await auth(hold,S);const pending=reflect(hold.query('select hold_delayed_message($1)',[mid]));await waitEdge(hp,rp);
  await rel.query('commit');const r=await pending;assert.match(String(r.error?.message),/no_longer_pending/);await hold.query('rollback');
  assert.equal(await released(mid),1);assert.equal((await db.query('select deliver_after=\'infinity\' h from messages where id=$1',[mid])).rows[0].h,false);
 });

 await test('hold in flight wins: release (forced) waits, then releases nothing; non-forced skips; nothing delivered after the old deadline',async()=>{
  const mid=await send('Race B','hc-key-2');await db.query(`update messages set deliver_after=clock_timestamp()+interval '500 milliseconds' where id=$1`,[mid]);
  const hold=await client(),rel=await client(),rel2=await client();const hp=await pid(hold),rp=await pid(rel);
  await auth(hold,S);assert.equal((await hold.query('select hold_delayed_message($1) ok',[mid])).rows[0].ok,true);
  await new Promise(r=>setTimeout(r,700)); // old deadline passes while the hold is still uncommitted
  await rel2.query('begin');assert.equal((await rel2.query('select _release_for($1,false) n',[R])).rows[0].n,0);await rel2.query('commit');
  await rel.query('begin');const pending=reflect(rel.query('select _release_for($1,true) n',[R]));await waitEdge(rp,hp);
  await hold.query('commit');const r=await pending;if(r.error)throw r.error;assert.equal(r.value.rows[0].n,0);await rel.query('commit');
  assert.equal(await released(mid),0);assert.equal((await db.query('select deliver_after=\'infinity\' h from messages where id=$1',[mid])).rows[0].h,true);
  await db.query('select _release_for($1,true)',[R]);await db.query('select push_release_tick()');assert.equal(await released(mid),0);
 });

 await test('parallel double hold is idempotent; resume + hold race ends in exactly one consistent state',async()=>{
  const mid=await send('Race C','hc-key-3');
  const one=async(sql)=>{const c=await client();await auth(c,S);try{const r=await c.query(sql,[mid]);await c.query('commit');return r.rows[0];}catch(e){await c.query('rollback');throw e;}};
  await Promise.all([one('select hold_delayed_message($1) ok'),one('select hold_delayed_message($1) ok')]);
  assert.equal((await db.query('select deliver_after=\'infinity\' h from messages where id=$1',[mid])).rows[0].h,true);
  await Promise.all([one('select resume_delayed_message($1) due'),one('select hold_delayed_message($1) ok')]);
  const st=(await db.query(`select deliver_after>clock_timestamp() pending from messages where id=$1`,[mid])).rows[0];
  assert.equal(st.pending,true);assert.equal(await released(mid),0);
 });
 console.log(JSON.stringify({pass,backend:'PostgreSQL',network:'guarded loopback synthetic database only'}));
}finally{await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));await db.close();}
