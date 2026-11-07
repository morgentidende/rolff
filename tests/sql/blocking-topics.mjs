// New synthetic users only. Actual providers/network are never touched.
export async function testBlockingTopics({db,as,svc,hash,t,assert}) {
 const [A,B,C,X]=(await db.query(`insert into auth.users(email) values ('topics-a@example.invalid'),('topics-b@example.invalid'),('topics-c@example.invalid'),('topics-x@example.invalid') returning id`)).rows.map(r=>r.id);
 await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`,[A,B]);
 const cv=(await as(A,`select create_conversation('Topic synthetic') c`))[0].c;
 const token=(await as(A,`select * from create_invitation($1,'parent')`,[cv]))[0].token;
 await as(B,`select accept_invitation($1)`,[token]);
 const snapshot=async()=> (await svc(`select recipient_filter_snapshot($1,$2) s`,[cv,A]))[0].s;
 const issue=async(revision,text='Kalender vedlagt')=>(await svc(`select issue_reply_approval_v3($1,$2,$3,'test','synthetic',$4,null) id`,[A,cv,await hash(text),revision]))[0].id;
 let topic;
 await t('Topics: arbitrary bounded private criteria, creation timestamps, own-only RLS',async()=>{
  topic=(await as(B,`select add_blocked_topic($1,'omtaler mine forældre') id`,[cv]))[0].id;
  assert.equal((await as(B,`select word from conversation_blocked_topics where id=$1`,[topic]))[0].word,'omtaler mine forældre');
  assert.equal((await as(A,`select * from conversation_blocked_topics`)).length,0);
  assert.equal((await as(X,`select * from conversation_blocked_topics`)).length,0);
  assert.equal((await as(A,`delete from conversation_blocked_topics where id=$1 returning id`,[topic])).length,0);
  await assert.rejects(as(X,`select add_blocked_topic($1,'mit udseende')`,[cv]),/not_member/);
  await assert.rejects(as(B,`select add_blocked_topic($1,$2)`,[cv,'x'.repeat(241)]),/length/);
  await assert.rejects(as(B,`select recipient_filter_snapshot($1,$2)`,[cv,A]),/permission denied/);
  assert.ok((await as(B,`select created_at from conversation_blocked_topics where id=$1`,[topic]))[0].created_at);
 });
 await t('Topics: snapshot excludes sender rules and includes neutral free-form recipient criteria',async()=>{
  await as(A,`select add_blocked_topic($1,'omtaler min cykel')`,[cv]);
  assert.deepEqual((await snapshot()).topics,['omtaler mine forældre']);
 });
 await t('Topics: word reset owner-scoped, topic list untouched, creation provenance retained',async()=>{
  await as(B,`select add_blocked_word($1,'æble',true)`,[cv]);await as(A,`select add_blocked_word($1,'egen liste',true)`,[cv]);
  const before=(await as(B,`select * from conversation_blocked_topics where id=$1`,[topic]))[0];
  const rev=(await snapshot()).revision;
  await as(B,`select reset_blocked_words($1)`,[cv]);
  assert.deepEqual((await snapshot()).words,[]);assert.notEqual((await snapshot()).revision,rev);
  assert.equal((await as(A,`select * from conversation_blocked_words where conversation_id=$1`,[cv])).length,1);
  assert.deepEqual((await as(B,`select * from conversation_blocked_topics where id=$1`,[topic]))[0],before);
  await assert.rejects(as(X,`select reset_blocked_words($1)`,[cv]),/not_member/);
 });
 await t('Topics: change between snapshot/AI and issuer rejects stale evaluation',async()=>{
  const old=await snapshot();await as(B,`select add_blocked_topic($1,'omtaler mit udseende')`,[cv]);
  await assert.rejects(issue(old.revision),/recipient_policy_changed/);
  assert.equal((await db.query(`select count(*)::int n from moderation_approvals where conversation_id=$1`,[cv])).rows[0].n,0);
 });
 await t('Topics: topic deletion between issuer and commit rejects, approval remains unconsumed',async()=>{
  const id=await issue((await snapshot()).revision);
  await as(B,`delete from conversation_blocked_topics where id=$1`,[topic]);
  await assert.rejects(svc(`select * from commit_message_reply($1,$2,$3,'Kalender vedlagt','topic-stale-0001',null)`,[id,A,cv]),/recipient_policy_changed/);
  assert.equal((await db.query(`select consumed_at from moderation_approvals where id=$1`,[id])).rows[0].consumed_at,null);
 });
 await t('Topics: word change invalidates attachment approval and prevents storage',async()=>{
  const bytes=Buffer.from([137,80,78,71]);const fh=(await db.query(`select encode(extensions.digest($1::bytea,'sha256'),'hex') h`,[bytes])).rows[0].h;
  const id=await issue((await snapshot()).revision,'Kalender vedlagt\n'+fh);
  await as(B,`select add_blocked_word($1,'kalender',true)`,[cv]);
  const before=(await db.query(`select count(*)::int n from message_attachments`)).rows[0].n;
  await assert.rejects(svc(`select * from commit_attachment_reply($1,$2,$3,'Kalender vedlagt','topic-stale-file','image/png','synthetic.png','',null,$4::bytea,null)`,[id,A,cv,bytes]),/recipient_policy_changed/);
  assert.equal((await db.query(`select count(*)::int n from message_attachments`)).rows[0].n,before);
 });
 await t('Topics: legacy v2 issuer cannot bypass cutover',async()=>{
  const id=(await svc(`select issue_reply_approval_v2($1,$2,$3,'test','old') id`,[A,cv,await hash('Kalender vedlagt')]))[0].id;
  await assert.rejects(svc(`select * from commit_message_reply($1,$2,$3,'Kalender vedlagt','topic-legacy-0001',null)`,[id,A,cv]),/approval_policy_outdated/);
 });
 await t('Topics: fresh current ticket commits and accepted retry survives later edits',async()=>{
  const id=await issue((await snapshot()).revision);
  const first=(await svc(`select * from commit_message_reply($1,$2,$3,'Kalender vedlagt','topic-current-001',null)`,[id,A,cv]))[0];
  await as(B,`select reset_blocked_words($1)`,[cv]);
  const retry=(await svc(`select * from commit_message_reply($1,$2,$3,'Kalender vedlagt','topic-current-001',null)`,[id,A,cv]))[0];
  assert.equal(retry.duplicate,true);assert.equal(first.message_id,retry.message_id);
  const ticket=(await db.query(`select * from moderation_approvals where id=$1`,[id])).rows[0];
  assert.ok(!JSON.stringify(ticket).includes('udseende'));
 });
 await t('Topics: owner export includes criteria, other owners export cannot expose them',async()=>{
  const own=(await svc(`select export_user_data($1) r`,[B]))[0].r;
  assert.ok(own.own_blocked_topics.some(x=>x.word==='omtaler mit udseende'));
  const other=(await svc(`select export_user_data($1) r`,[X]))[0].r;
  assert.deepEqual(other.own_blocked_topics,[]);
 });
 await t('Topics: 20-item bound rejects twenty-first criterion without changing revision',async()=>{
  for(let i=0;i<19;i++)await as(B,`select add_blocked_topic($1,$2)`,[cv,`opdigtet emne ${i}`]);
  const rev=(await snapshot()).revision;
  await assert.rejects(as(B,`select add_blocked_topic($1,'et emne for meget')`,[cv]),/too_many/);
  assert.equal((await snapshot()).revision,rev);
 });
 await t('Topics: active-recipient membership changes invalidate pending ticket',async()=>{
  const id=await issue((await snapshot()).revision,'Praktisk aftale');
  await db.query(`update memberships set left_at=clock_timestamp() where conversation_id=$1 and user_id=$2`,[cv,B]);
  await assert.rejects(svc(`select * from commit_message_reply($1,$2,$3,'Praktisk aftale','topic-member-001',null)`,[id,A,cv]),/recipient_policy_changed/);
 });
}
