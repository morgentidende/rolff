// Notification text names the sender by the RECIPIENT's own private nickname, else by the sender's e-mail
// address (shortened to 40 characters); never message text. Excludes muted conversations, respects receive windows and tells the sender nothing.
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
const alias=(owner,contact,a)=>as(owner,'select set_contact_alias($1,$2)',[contact,a]);
const newUser=async tag=>(await query("insert into auth.users(email) values ($1) returning id",[`${tag}@example.invalid`]))[0].id;
const W=await newUser('sender-w'),Z=await newUser('sender-z');
const setMail=(id,e)=>query('update auth.users set email=$2 where id=$1',[id,e]);
const MV='far@example.invalid',MW='mor@example.invalid',MZ='onkel@example.invalid';
const resetMail=async()=>{await setMail(V,MV);await setMail(W,MW);await setMail(Z,MZ);};

await query('update push_runtime set enabled=true,vapid_public_key=$1',[pub]);
await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);
const fV=await notificationFixture(db,V,U),fW=await notificationFixture(db,W,U),fZ=await notificationFixture(db,Z,U);
for(const f of [fV,fW,fZ])await f.window(false); // receive times off = always in window
const fresh=async()=>{await query('delete from notification_jobs');await query('delete from push_attempts');await query('delete from conversation_mutes');await query('delete from contact_aliases');await query("update message_deliveries set released_at=released_at-interval '1 minute' where released_at is not null");};
const tick=()=>svc('select push_release_tick()');
const lastJob=async()=>(await query('select id from notification_jobs order by id desc limit 1'))[0].id;
const who=async()=>(await svc('select push_notice_who($1,$2,clock_timestamp()) w',[U,await lastJob()]))[0].w;

await test('no nickname: the sender is named by e-mail address; with no e-mail either, nobody is named',async()=>{
  await fresh();await resetMail();await fV.message();await tick();
  assert.deepEqual(await who(),{s:[MV],k:1,n:1});
  const w=await claim();assert.equal(w.length,1);const p=await prepare(w[0]);assert.deepEqual(p.who,{s:[MV],k:1,n:1});
  await setMail(V,null);assert.deepEqual(await who(),{s:[],k:1,n:1},'no nickname and no e-mail => generic text');
  await setMail(V,'   ');assert.deepEqual(await who(),{s:[],k:1,n:1},'blank e-mail is not a name');
});
await test('own nickname names the sender; one message vs several messages',async()=>{
  await fresh();await resetMail();await alias(U,V,'Far');await fV.message();await tick();
  assert.deepEqual(await who(),{s:['Far'],k:1,n:1},'nickname wins over e-mail');
  await fV.message();await tick();assert.deepEqual(await who(),{s:['Far'],k:1,n:2});
});
await test('two senders: both named, most recent first; three senders: one name and the count',async()=>{
  await fresh();await alias(U,V,'Far');await alias(U,W,'Mor');await alias(U,Z,'Onkel');
  await fV.message();await tick();await fW.message();await tick();
  assert.deepEqual(await who(),{s:['Mor','Far'],k:2,n:2});
  await fZ.message();await tick();
  assert.deepEqual(await who(),{s:['Onkel'],k:3,n:3});
});
await test('mixed: one nickname and one e-mail; a sender with neither is counted but not named',async()=>{
  await fresh();await resetMail();await alias(U,V,'Far');await fV.message();await fW.message();await tick();
  assert.deepEqual((await who()).s.sort(),['Far',MW].sort());
  await setMail(W,null);assert.deepEqual(await who(),{s:['Far'],k:2,n:2});await resetMail();
});
await test('only the recipient\'s own nicknames are used, not other people\'s; the recipient\'s own e-mail is never used',async()=>{
  await fresh();await resetMail();await setMail(U,'recipient@example.invalid');await alias(V,U,'Not for U');await alias(W,U,'Not for U either');await fW.message();await tick();
  const w=await who();assert.deepEqual(w,{s:[MW],k:1,n:1});assert(!JSON.stringify(w).includes('Not for U'));assert(!JSON.stringify(w).includes('recipient@'));
});
await test('muted conversations are neither named nor counted; all-muted sends nothing',async()=>{
  await fresh();await resetMail();await alias(U,V,'Far');await mute(U,fV.conv,'always');
  await fV.message();await fW.message();await tick();
  assert.deepEqual(await who(),{s:[MW],k:1,n:1});
  const p=await prepare((await claim())[0]);assert(!JSON.stringify(p).includes('Far'));assert(!JSON.stringify(p).includes(MV),'muted sender e-mail never appears');
  await fresh();await alias(U,V,'Far');await mute(U,fV.conv,'always');await fV.message();await tick();
  assert.equal((await claim()).length,0,'job closed without push when everything is muted');
});
await test('an expired mute names the sender again',async()=>{
  await fresh();await alias(U,V,'Far');await mute(U,fV.conv,'8h');await query("update conversation_mutes set mute_until=clock_timestamp()-interval '1 second'");
  await fV.message();await tick();assert.deepEqual(await who(),{s:['Far'],k:1,n:1});
});
await test('nickname is cleaned: control and bidi characters removed (the 40-character cap is also enforced by set_contact_alias, the dispatcher and the worker)',async()=>{
  await fresh();await alias(U,V,'\u202eFar\u200b\u0007 '+'x'.repeat(30));await fV.message();await tick();
  const w=await who();assert.equal(w.s[0],'Far '+'x'.repeat(30));assert(w.s[0].startsWith('Far x'));assert(!/[\u0000-\u001f\u200b-\u200f\u202a-\u202e]/.test(w.s[0]));
  await fresh();await resetMail();await alias(U,V,'\u200b\u200e');await fV.message();await tick();assert.deepEqual((await who()).s,[MV],'an empty cleaned nickname falls back to the e-mail');
  await setMail(V,'f\u200bar\u202e@example.invalid');assert.deepEqual((await who()).s,['far@example.invalid'],'e-mail is cleaned like a nickname');await resetMail();
});
await test('long e-mail addresses are shortened to at most 40 characters and keep a short domain',async()=>{
  await fresh();await fV.message();await tick();
  const short=async e=>{await setMail(V,e);const n=(await who()).s[0];assert(Array.from(n).length<=40,n);return n;};
  assert.equal(await short('exactly.forty.chars.local@example.invalid'.slice(0,40)),'exactly.forty.chars.local@example.invali'.slice(0,40));
  const a=await short('very.long.local.part.of.an.address'+'@example.invalid');assert.equal(Array.from(a).length,40);assert(a.endsWith('…@example.invalid'),a);assert(a.startsWith('very.long'),a);
  const b=await short('x@'+'d'.repeat(60)+'.example');assert.equal(Array.from(b).length,40);assert(b.endsWith('…'),b);
  const c=await short('l'.repeat(70)+'@b.dk');assert.equal(Array.from(c).length,40);assert(c.endsWith('…@b.dk'),c);
  assert.equal(await short('far@example.invalid'),'far@example.invalid','short addresses are untouched');
  await resetMail();
});
await test('message text, conversation id and sender id never appear in the notice data (and no e-mail when a nickname exists)',async()=>{
  await fresh();await resetMail();await alias(U,V,'Far');await fV.message();await tick();const p=await prepare((await claim())[0]);
  const t=JSON.stringify(p.who);assert(!t.includes('Synthetic notification message'));assert(!t.includes(V));assert(!t.includes(fV.conv));assert(!t.includes(MV),'nickname present: e-mail not used');
  assert.deepEqual(Object.keys(p.who).sort(),['k','n','s']);
});
await test('receive windows still apply: nothing is prepared (or named) while times are closed',async()=>{
  await fresh();await alias(U,V,'Far');await fV.message();await tick();const w=await claim();assert.equal(w.length,1);
  await fV.window(true);assert.equal(await prepare(w[0]),null);await fV.window(false);
});
await test('a message held by receive times creates no job and no name data',async()=>{
  await fresh();await fV.window(true);await alias(U,V,'Far');await fV.message();await tick();
  assert.equal((await query('select count(*)::int n from notification_jobs'))[0].n,0);await fV.window(false);
});
await test('helper is service-role only; the sender cannot call it or see nicknames or jobs',async()=>{
  await fresh();await alias(U,V,'Far');await fV.message();await tick();const id=await lastJob();
  for(const r of ['authenticated','anon'])await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${r}`);await tx.query('select push_notice_who($1,$2,now())',[U,id]);}),/permission denied/);
  assert.equal((await as(V,'select * from contact_aliases')).length,0);
  await assert.rejects(as(V,'select * from notification_jobs'),/permission denied/);
});
await test('sender-facing conversation data has no push, mute, delivery or read fields',async()=>{
  await fresh();await alias(U,V,'Far');await fV.message();await tick();await claim();
  for(const fn of ['list_my_conversations','list_my_conversations_v2']){
    const rows=await as(V,`select to_jsonb(l) j from ${fn}() l`);assert(rows.length>0);
    const keys=new Set();const walk=o=>{if(o&&typeof o==='object')for(const [k,v] of Object.entries(o)){keys.add(k);walk(v);}};rows.forEach(r=>walk(r.j));
    for(const k of keys)assert(!/push|notif|mute|read|deliver|seen/i.test(k),`${fn}: ${k}`);
    assert(!JSON.stringify(rows).includes('"Far"'),'recipient nickname is not visible to the sender');
  }
});
console.log(JSON.stringify({pass,fail:0,backend:process.env.TIMEZONE_SQL_BACKEND==='postgres'?'PostgreSQL':'pglite',network:'none',realContent:false}));await db.close();
