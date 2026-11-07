// Local synthetic CI PostgreSQL17 only. Uses existing explicit opt-in guard, never production.
import assert from 'node:assert/strict';
import {bootstrap,connectPG} from './timezone-test-db.mjs';
if(process.env.TIMEZONE_SQL_BACKEND!=='postgres')throw Error('This test requires real PostgreSQL parallel connections');
const {db,U:A,V:B}=await bootstrap(),clients=[];
async function client(){const c=await connectPG();clients.push(c);c.pid=(await c.query('select pg_backend_pid() p')).rows[0].p;return c;}
async function begin(c,user){await c.query('begin');if(user){await c.query('set local role authenticated');await c.query("select set_config('request.jwt.sub',$1,true)",[user]);}}
const reflected=p=>p.then(value=>({value}),error=>({error}));
async function waitBlocked(waiter,holder){const end=Date.now()+3500;while(Date.now()<end){if((await db.query('select $2::int=any(pg_blocking_pids($1::int)) b',[waiter.pid,holder.pid])).rows[0].b)return;await new Promise(setImmediate);}throw Error('Expected actual lock wait not observed');}
const cv=(await db.query('insert into conversations(created_by) values($1) returning id',[A])).rows[0].id;
await db.query(`insert into memberships(conversation_id,user_id,role) values($1,$2,'parent'),($1,$3,'parent')`,[cv,A,B]);
await db.query(`insert into user_plans(user_id,plan) values($1,'text_attachments'),($2,'text_attachments')`,[A,B]);
const text='Syntetisk praktisk aftale';
const hash=(await db.query(`select encode(extensions.digest($1,'sha256'),'hex') h`,[text])).rows[0].h;
async function revision(){return(await db.query('select recipient_filter_snapshot($1,$2) s',[cv,A])).rows[0].s.revision;}
async function issue(c,rev){return(await c.query("select issue_reply_approval_v3($1,$2,$3,'test','fabricated',$4,null) id",[A,cv,hash,rev])).rows[0].id;}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('ok',name);}
try{
 await test('uncommitted word edit blocks issuer then stale pre-AI revision is rejected',async()=>{
  const r=await revision(),edit=await client(),issuer=await client();await begin(edit,B);
  await edit.query("select add_blocked_word($1,'fiktivt ord',true)",[cv]);await begin(issuer);
  const pending=reflected(issue(issuer,r));await waitBlocked(issuer,edit);await edit.query('commit');
  assert.match((await pending).error?.message||'',/recipient_policy_changed/);await issuer.query('rollback');
 });
 await test('uncommitted topic edit blocks consumption then stale ticket cannot store',async()=>{
  const issuer=await client(),edit=await client(),consumer=await client(),r=await revision();
  const id=await issue(issuer,r);await begin(edit,B);await edit.query("select add_blocked_topic($1,'omtaler min opdigtede cykel')",[cv]);await begin(consumer);
  const pending=reflected(consumer.query("select * from commit_message_reply($1,$2,$3,$4,'synthetic-topic-race',null)",[id,A,cv,text]));
  await waitBlocked(consumer,edit);await edit.query('commit');assert.match((await pending).error?.message||'',/recipient_policy_changed/);await consumer.query('rollback');
  assert.equal(Number((await db.query('select count(*) n from messages where conversation_id=$1',[cv])).rows[0].n),0);
 });
 await test('consumed send holds revision until commit; a later edit waits without invalidating historical retry',async()=>{
  const issuer=await client(),consumer=await client(),edit=await client(),id=await issue(issuer,await revision());
  await begin(consumer);const first=(await consumer.query("select * from commit_message_reply($1,$2,$3,$4,'synthetic-topic-valid',null)",[id,A,cv,text])).rows[0];
  await begin(edit,B);const pending=reflected(edit.query("select reset_blocked_words($1)",[cv]));await waitBlocked(edit,consumer);await consumer.query('commit');const result=await pending;if(result.error)throw result.error;await edit.query('commit');
  const retry=(await consumer.query("select * from commit_message_reply($1,$2,$3,$4,'synthetic-topic-valid',null)",[id,A,cv,text])).rows[0];assert.equal(retry.duplicate,true);assert.equal(retry.message_id,first.message_id);
 });
 console.log(JSON.stringify({passed,backend:'PostgreSQL',locks:'real parallel connections',scope:'synthetic topic policy correctness only'}));
}finally{await Promise.allSettled(clients.map(c=>c.query('rollback')));await Promise.allSettled(clients.map(c=>c.end()));await db.close();}
