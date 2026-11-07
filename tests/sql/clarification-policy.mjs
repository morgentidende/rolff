// Synthetic policy-cutover integration tests. No provider calls or real messages.
export async function testClarificationPolicy({db,as,svc,hash,t,assert}) {
 const [A,B]=(await db.query(`insert into auth.users(email) values ('clarify-a@example.invalid'),('clarify-b@example.invalid') returning id`)).rows.map(r=>r.id);
 await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`,[A,B]);
 const cv=(await as(A,`select create_conversation('Clarification synthetic') c`))[0].c;
 const token=(await as(A,`select * from create_invitation($1,'parent')`,[cv]))[0].token;
 await as(B,`select accept_invitation($1)`,[token]);
 const text='Kan vi mødes ved biblioteket?';
 const oldTicket=async()=> (await svc(`select issue_approval($1,$2,$3,'test','synthetic') id`,[A,cv,await hash(text)]))[0].id;
 await t('Clarify cutover: legacy issuer cannot commit text',async()=>{
  const id=await oldTicket();
  await assert.rejects(svc(`select * from commit_message($1,$2,$3,$4,'clarify-old-text')`,[id,A,cv,text]),/approval_policy_outdated/);
  assert.equal((await db.query(`select consumed_at from moderation_approvals where id=$1`,[id])).rows[0].consumed_at,null);
 });
 await t('Clarify cutover: old in-flight reply issuer cannot commit',async()=>{
  const id=(await svc(`select issue_reply_approval($1,$2,$3,'test','synthetic',null) id`,[A,cv,await hash(text)]))[0].id;
  await assert.rejects(svc(`select * from commit_message_reply($1,$2,$3,$4,'clarify-old-reply',null)`,[id,A,cv,text]),/approval_policy_outdated/);
 });
 await t('Clarify cutover: policy cannot be promoted during consumption',async()=>{
  const id=await oldTicket();
  await assert.rejects(svc(`update moderation_approvals set consumed_at=clock_timestamp(),policy_version=1 where id=$1`,[id]),/approval_policy_outdated/);
 });
 await t('Clarify cutover: current issuer is server-only',async()=>{
  await assert.rejects(as(A,`select issue_reply_approval_v2($1,$2,$3,'test','synthetic',null)`,[A,cv,await hash(text)]),/permission denied/);
  await assert.rejects(as(A,`update moderation_approvals set policy_version=1`),/permission denied/);
 });
 await t('Clarify cutover: current acceptance and historical retry',async()=>{
  const id=(await svc(`select issue_reply_approval_v2($1,$2,$3,'test','synthetic',null) id`,[A,cv,await hash(text)]))[0].id;
  assert.equal((await db.query(`select policy_version from moderation_approvals where id=$1`,[id])).rows[0].policy_version,1);
  const first=(await svc(`select * from commit_message_reply($1,$2,$3,$4,'clarify-current',null)`,[id,A,cv,text]))[0];
  assert.equal(first.duplicate,false);
  // Existing consumed tickets receive zero on migration. Accepted retries stay valid.
  await db.query(`update moderation_approvals set policy_version=0 where id=$1`,[id]);
  const retry=(await svc(`select * from commit_message_reply(gen_random_uuid(),$1,$2,$3,'clarify-current',null)`,[A,cv,text]))[0];
  assert.equal(retry.duplicate,true);assert.equal(retry.message_id,first.message_id);
 });
 await t('Clarify cutover: old attachment approval cannot store a file',async()=>{
  const bytes=Buffer.from([137,80,78,71]),caption='Kalender for næste uge';
  const fh=(await db.query(`select encode(extensions.digest($1::bytea,'sha256'),'hex') h`,[bytes])).rows[0].h;
  const id=(await svc(`select issue_reply_approval($1,$2,$3,'test','synthetic',null) id`,[A,cv,await hash(caption+'\n'+fh)]))[0].id;
  const before=(await db.query(`select count(*)::int n from message_attachments`)).rows[0].n;
  await assert.rejects(svc(`select * from commit_attachment_reply($1,$2,$3,$4,'clarify-old-file','image/png','synthetic.png','',null,$5::bytea,null)`,[id,A,cv,caption,bytes]),/approval_policy_outdated/);
  assert.equal((await db.query(`select count(*)::int n from message_attachments`)).rows[0].n,before);
 });
 await t('Clarify audit is separate from harm and creates no approval/message',async()=>{
  const snap=async()=> (await db.query(`select (select count(*)::int from moderation_approvals where sender_id=$1) a,(select count(*)::int from messages where sender_id=$1) m`,[A])).rows[0];
  const before=await snap();await svc(`select record_attempt($1,$2,'clarify','unclear_meaning')`,[A,cv]);
  assert.equal((await db.query(`select count(*)::int n from moderation_attempts where sender_id=$1 and decision='clarify' and reason_code='unclear_meaning'`,[A])).rows[0].n,1);
  assert.deepEqual(await snap(),before);
 });
}
