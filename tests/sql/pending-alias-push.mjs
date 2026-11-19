// Integration check (PR93 push_notice_who + PR95 pending nickname): a nickname set on a PENDING invitation names the
// sender in the recipient's push once the invitee accepted and writes; no nickname -> e-mail fallback.
import assert from 'node:assert/strict';
import {bootstrap} from './timezone-test-db.mjs';
const {db,U,V}=await bootstrap();
const query=async(sql,p=[])=>(await db.query(sql,p)).rows;
const as=async(uid,sql,p=[])=>db.transaction(async tx=>{await tx.exec(`set local role authenticated;select set_config('request.jwt.sub','${uid}',true)`);return (await tx.query(sql,p)).rows;});
const svc=async(sql,p=[])=>db.transaction(async tx=>{await tx.exec('set local role service_role');return(await tx.query(sql,p)).rows;});
const pub='B'+'A'.repeat(86),auth='A'.repeat(22),endpoint='https://fcm.googleapis.com/fcm/send/SyntheticOnly';
await query('update push_runtime set enabled=true,vapid_public_key=$1',[pub]);
await as(U,'select save_my_push($1,$2,$3,null)',[endpoint,pub,auth]);
await query("update auth.users set email='inviter@example.invalid' where id=$1",[U]);
await query("update auth.users set email='far@example.invalid' where id=$1",[V]);
const sender=V,recipient=U;
// U invites V by e-mail, gives the pending invitation a nickname, V accepts
const inv=(await as(U,"select * from create_email_invitation('far@example.invalid')"))[0];
await as(U,'select set_invitation_alias($1,$2)',[inv.invitation_id,'Far']);
await as(V,'select accept_invitation($1)',[inv.token]);
const conv=inv.conversation_id;
// receive times off for U
const s=(await as(U,'select get_my_receive_settings(null) s'))[0].s;await as(U,"select save_my_receive_settings($1,$3::jsonb,'fixed','UTC',null,$2)",[false,s.revision,'[]']);
const digest=async t=>(await query("select encode(extensions.digest($1,'sha256'),'hex') h",[t]))[0].h;
let n=0;
const message=async()=>{const text=`Synthetic message ${++n}`;await svc('select * from prepare_send($1,$2,$3)',[sender,conv,text]);const snap=(await svc('select recipient_filter_snapshot($1,$2) s',[conv,sender]))[0].s;
 const id=(await svc("select issue_reply_approval_v3($1,$2,$3,'synthetic','mock-no-model-call',$4,null) id",[sender,conv,await digest(text),snap.revision]))[0].id;
 return (await svc('select * from commit_message_reply($1,$2,$3,$4,$5,null)',[id,sender,conv,text,`k-${n}-${conv}`]))[0].message_id;};
const tick=()=>svc('select push_release_tick()');
const who=async()=>{const j=(await query('select id from notification_jobs order by id desc limit 1'))[0].id;return (await svc('select push_notice_who($1,$2,clock_timestamp()) w',[U,j]))[0].w;};
await message();await tick();
assert.deepEqual(await who(),{s:['Far'],k:1,n:1},'nickname set while pending names the sender in the push');
// clearing it falls back to the sender's e-mail (PR93 rule)
await as(U,'select set_contact_alias($1,$2)',[V,'']);
await query('delete from notification_jobs');await query('delete from push_attempts');
await query("update message_deliveries set released_at=released_at-interval '1 minute' where released_at is not null");
await message();await tick();
assert.deepEqual(await who(),{s:['far@example.invalid'],k:1,n:1},'no nickname -> e-mail fallback');
// an invitation WITHOUT a pending nickname -> e-mail fallback straight away
const inv2=(await as(U,"select * from create_email_invitation('mor@example.invalid')"))[0];
const [M]=(await query("insert into auth.users(email) values ('mor@example.invalid') returning id")).map(r=>r.id);
await as(M,'select accept_invitation($1)',[inv2.token]);
assert.equal((await query('select count(*)::int n from contact_aliases where owner_id=$1 and contact_user_id=$2',[U,M]))[0].n,0,'no nickname row is invented');
console.log(JSON.stringify({pass:3,fail:0,backend:process.env.TIMEZONE_SQL_BACKEND==='postgres'?'PostgreSQL':'pglite',network:'none',realContent:false}));await db.close();
