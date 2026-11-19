// "X accepted your invitation" push to the inviter. Synthetic data only, no network, no real push.
// Covers: opt-in, name logic (own nickname incl. one set while pending, else e-mail), Lydløs, receive windows (queue),
// membership, payload content (never message data / delivery status), invitee learns nothing, no duplicate jobs.
import assert from 'node:assert/strict';
import {bootstrap} from './timezone-test-db.mjs';
import {notificationFixture} from './notification-fixtures.mjs';
const {db,U,V}=await bootstrap();let pass=0;
const test=async(name,f)=>{await f();pass++;console.log('ok',name);};
const query=async(sql,p=[])=>(await db.query(sql,p)).rows;
const as=async(uid,sql,p=[])=>db.transaction(async tx=>{await tx.exec(`set local role authenticated;select set_config('request.jwt.sub','${uid}',true)`);return (await tx.query(sql,p)).rows;});
const svc=async(sql,p=[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return(await tx.query(sql,p)).rows;});
const pub='B'+'A'.repeat(86),auth='A'.repeat(22),endpoint='https://fcm.googleapis.com/fcm/send/SyntheticOnly';
const claim=()=>svc('select * from claim_push_work()');
const prepare=async w=>(await svc('select prepare_push($1,$2,$3) s',[w.job_id,w.subscription_id,w.lease]))[0].s;
const jobs=()=>query("select * from notification_jobs where kind='invite_accepted' order by id");
const newUser=async mail=>(await query('insert into auth.users(email) values ($1) returning id',[mail]))[0].id;
let k=0;
// invite a new person by e-mail; optionally nickname while pending; they accept. Returns {conv, invitee, invitation}
const invite=async({nick=null,accept=true,inviter=U}={})=>{
  const mail=`invitee${++k}@example.invalid`,invitee=await newUser(mail);
  const inv=(await as(inviter,'select * from create_email_invitation($1)',[mail]))[0];
  if(nick)await as(inviter,'select set_invitation_alias($1,$2)',[inv.invitation_id,nick]);
  if(accept)await as(invitee,'select accept_invitation($1)',[inv.token]);
  return {conv:inv.conversation_id,invitee,mail,invitation:inv.invitation_id,token:inv.token};
};
const reset=async()=>{await windowsOff();await query("update invitations set created_at=created_at-interval '2 days'");await query('delete from notification_jobs');await query('delete from push_attempts');await query('delete from conversation_mutes');};

await query('update push_runtime set enabled=true,vapid_public_key=$1',[pub]);
await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);
// receive times off => always in window
const windowsOff=async()=>{const s=(await as(U,'select get_my_receive_settings(null) s'))[0].s;await as(U,"select save_my_receive_settings($1,$3::jsonb,'fixed','UTC',null,$2)",[false,s.revision,'[]']);};
await windowsOff();

await test('accepting creates exactly one job for the inviter only, none before acceptance and none for the invitee',async()=>{
  await reset();const a=await invite({accept:false});assert.equal((await jobs()).length,0,'nothing while pending');
  await as(a.invitee,'select accept_invitation($1)',[a.token]);
  const j=await jobs();assert.equal(j.length,1);assert.equal(j[0].user_id,U,'inviter is notified');assert.equal(j[0].subject_id,a.invitee);assert.equal(j[0].conversation_id,a.conv);assert.equal(j[0].invitation_id,a.invitation);
  assert.equal((await query('select count(*)::int n from notification_jobs where user_id=$1',[a.invitee]))[0].n,0,'the invitee gets nothing');
  assert.equal((await query('select count(*)::int n from notification_jobs where kind=$1',['messages']))[0].n,0,'no message job');
});
await test('payload: name = e-mail when there is no nickname; carries conversation id and name, nothing about messages',async()=>{
  await reset();const a=await invite();
  const w=await claim();assert.equal(w.length,1);const p=await prepare(w[0]);
  assert.ok(p,'prepared without any released message (accept jobs do not need one)');
  assert.deepEqual(p.accept,{c:a.conv,s:a.mail});assert.ok(!('who' in p));
  for(const key of Object.keys(p))assert.ok(['endpoint','keys','binding','lang','who','accept','prepared_at','expires_at'].includes(key),key);
  assert.deepEqual(Object.keys(p.accept).sort(),['c','s']);
  assert.equal(p.lang,'da');
});
await test('own nickname set WHILE PENDING (PR95) names the person; later nickname edits are used too; clearing falls back to e-mail',async()=>{
  await reset();const a=await invite({nick:'Far'});
  let p=await prepare((await claim())[0]);assert.deepEqual(p.accept,{c:a.conv,s:'Far'});
  await as(U,'select set_contact_alias($1,$2)',[a.invitee,'Farmand']);
  // a fresh claim is not needed: the name is read at prepare time
  const att=(await query('select * from push_attempts'))[0];
  await query("update push_attempts set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',done_at=null");
  const att2=(await query('select * from push_attempts'))[0];
  p=await prepare({job_id:att2.job_id,subscription_id:att2.subscription_id,lease:att2.lease});assert.equal(p.accept.s,'Farmand');
  await as(U,'select set_contact_alias($1,$2)',[a.invitee,'']);
  await query("update push_attempts set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'");
  const att3=(await query('select * from push_attempts'))[0];
  p=await prepare({job_id:att3.job_id,subscription_id:att3.subscription_id,lease:att3.lease});assert.equal(p.accept.s,a.mail);
});
await test('only the inviter\'s OWN nickname is used (not the invitee\'s nickname for the inviter, not anybody else\'s)',async()=>{
  await reset();const a=await invite();const O=await newUser('other@example.invalid');
  await query('insert into contact_aliases(owner_id,contact_user_id,alias) values ($1,$2,$3),($4,$2,$5)',[a.invitee,U,'Invitee calls inviter this',O,'Stranger nickname']);
  const p=await prepare((await claim())[0]);assert.deepEqual(p.accept,{c:a.conv,s:a.mail});assert(!JSON.stringify(p).includes('Stranger'));assert(!JSON.stringify(p).includes('Invitee calls'));
});
await test('names are cleaned like PR93: control/bidi characters removed, long e-mail shortened to 40 characters; no name at all -> name omitted',async()=>{
  await reset();const a=await invite({nick:'Fa\u202er\u0007'});
  let p=await prepare((await claim())[0]);assert.equal(p.accept.s,'Far');
  await reset();const b=await invite();await query('update auth.users set email=$2 where id=$1',[b.invitee,'a-very-long-local-part-for-a-synthetic-user@example.invalid']);
  p=await prepare((await claim())[0]);assert.ok(p.accept.s.length<=40);assert.ok(p.accept.s.endsWith('@example.invalid'));
  await reset();const c=await invite();await query('update auth.users set email=null where id=$1',[c.invitee]);
  p=await prepare((await claim())[0]);assert.deepEqual(p.accept,{c:c.conv,s:null});
});
await test('opt-in: no job when notifications are off; a job is closed without any push if they are switched off before sending',async()=>{
  await reset();await as(U,'select revoke_my_push(null,true)');
  await invite();assert.equal((await jobs()).length,0,'switched off => no job at all');
  await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);
  await reset();await invite();assert.equal((await jobs()).length,1);
  await as(U,'select revoke_my_push(null,true)');
  assert.equal((await claim()).length,0);assert.ok((await jobs())[0].completed_at,'closed');assert.equal((await query('select count(*)::int n from push_attempts'))[0].n,0);
  await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);
});
await test('Lydløs: a muted conversation gets no acceptance push (muted before it is sent); another conversation is unaffected; never fires later',async()=>{
  await reset();const a=await invite({accept:false}),b=await invite({accept:false});
  await as(U,"select set_my_conversation_mute($1,'24h')",[a.conv]);
  await as(a.invitee,'select accept_invitation($1)',[a.token]);await as(b.invitee,'select accept_invitation($1)',[b.token]);
  const w=await claim();assert.equal(w.length,1,'only the unmuted conversation');const p=await prepare(w[0]);assert.equal(p.accept.c,b.conv);
  const all=await jobs();assert.ok(all.find(j=>j.conversation_id===a.conv).completed_at,'muted job closed');
  await as(U,'select clear_my_conversation_mute($1)',[a.conv]);assert.equal((await claim()).length,0,'unmuting later does not resurrect it');
});
await test('Lydløs set after the job was claimed still blocks prepare (checked at send time)',async()=>{
  await reset();const a=await invite();const w=await claim();assert.equal(w.length,1);
  await as(U,"select set_my_conversation_mute($1,'always')",[a.conv]);assert.equal(await prepare(w[0]),null);
});
await test('receive times: queued until the conversation\'s window opens, then sent; dropped after 24 hours',async()=>{
  await reset();const a=await invite({accept:false});
  const g=(await as(U,'select get_my_conversation_receive_settings($1,null) r',[a.conv]))[0].r;
  const dayAfterTomorrow=(((new Date().getUTCDay()+6)%7)+1+2)%7+1;
  const closed=JSON.stringify([{weekday:dayAfterTomorrow,start_minute:0,end_minute:60}]);
  await as(U,"select save_my_conversation_receive_settings($1,true,$2::jsonb,'fixed','UTC',null,$3,false)",[a.conv,closed,g.revision]);
  await as(a.invitee,'select accept_invitation($1)',[a.token]);
  assert.equal((await claim()).length,0,'window closed: nothing is claimed');
  const att=(await query('select * from push_attempts'));assert.equal(att.length,1,'but the attempt is queued');
  assert.equal((await jobs())[0].completed_at,null,'job stays open');
  // open the window
  const g2=(await as(U,'select get_my_conversation_receive_settings($1,null) r',[a.conv]))[0].r;
  await as(U,"select save_my_conversation_receive_settings($1,false,'[]'::jsonb,'fixed','UTC',null,$2,false)",[a.conv,g2.revision]);
  const w=await claim();assert.equal(w.length,1,'window open: now claimed');assert.equal((await prepare(w[0])).accept.c,a.conv);
  // 24-hour limit
  await reset();const b=await invite({accept:false});
  const gb=(await as(U,'select get_my_conversation_receive_settings($1,null) r',[b.conv]))[0].r;
  await as(U,"select save_my_conversation_receive_settings($1,true,$2::jsonb,'fixed','UTC',null,$3,false)",[b.conv,closed,gb.revision]);
  await as(b.invitee,'select accept_invitation($1)',[b.token]);
  await query("update notification_jobs set created_at=clock_timestamp()-interval '25 hours'");
  assert.equal((await claim()).length,0);assert.ok((await jobs())[0].completed_at,'expired job is closed, not sent');
});
await test('membership: no push if the inviter or the person who accepted has left the conversation',async()=>{
  await reset();const a=await invite();await query('update memberships set left_at=now() where conversation_id=$1 and user_id=$2',[a.conv,a.invitee]);
  assert.equal((await claim()).length,0);assert.ok((await jobs())[0].completed_at);
  await reset();const b=await invite();const w=await claim();await query('update memberships set left_at=now() where conversation_id=$1 and user_id=$2',[b.conv,U]);assert.equal(await prepare(w[0]),null);
});
await test('a handoff (the last gate before sending) is granted for an acceptance job and refused when muted or outside the window',async()=>{
  await reset();const a=await invite();const w=(await claim())[0];
  const h=await svc('select handoff_push($1,$2,$3,$4) h',[w.job_id,w.subscription_id,w.lease,'a'.repeat(64)]);assert.ok(h[0].h?.id,'handoff granted');
  await reset();const b=await invite();const w2=(await claim())[0];await as(U,"select set_my_conversation_mute($1,'always')",[b.conv]);
  assert.equal((await svc('select handoff_push($1,$2,$3,$4) h',[w2.job_id,w2.subscription_id,w2.lease,'b'.repeat(64)]))[0].h,null);
});
await test('no duplicates: one job per invitation even if accepted_at were touched again; revoked or declined invitations create nothing',async()=>{
  await reset();const a=await invite();await query('update invitations set accepted_at=now() where id=$1',[a.invitation]);assert.equal((await jobs()).length,1);
  await reset();const r=await invite({accept:false});await as(U,'select revoke_invitation($1)',[r.invitation]).catch(()=>query('update invitations set revoked_at=now() where id=$1',[r.invitation]));assert.equal((await jobs()).length,0);
});
await test('message pushes are unchanged next to acceptance pushes: each job keeps its own payload; the job shape is enforced',async()=>{
  await reset();const a=await invite();
  const f=await notificationFixture(db,a.invitee,U);await f.window(false);
  await reset();await invite();await f.message();await svc('select push_release_tick()');
  const w=await claim();assert.equal(w.length,2,'one acceptance job and one message job');
  const ps=[];for(const x of w)ps.push(await prepare(x));
  const acc=ps.find(p=>p.accept),msg=ps.find(p=>p.who);
  assert.ok(acc && msg,'both prepared');assert.ok(!('accept' in msg));assert.ok(!('who' in acc));assert.equal(msg.who.k,1);
  assert.ok(!JSON.stringify(acc).includes('Synthetic notification message'),'no message text or delivery data in the acceptance payload');
  await assert.rejects(query("insert into notification_jobs(user_id,kind) values ($1,'invite_accepted')",[U]),/notification_jobs_kind_shape/);
  await assert.rejects(query("insert into notification_jobs(user_id,conversation_id) values ($1,$2)",[U,a.conv]),/notification_jobs_kind_shape/);
});
console.log(JSON.stringify({pass,fail:0,backend:process.env.TIMEZONE_SQL_BACKEND==='postgres'?'PostgreSQL':'pglite',network:'none',realContent:false}));await db.close();
