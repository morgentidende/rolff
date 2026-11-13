// Synthetic users only. No real messages, accounts or model calls.
export async function testBlockAttachments({ db, as, svc, hash, t, assert, rejects }) {
  const [A, B, X] = (await db.query(`insert into auth.users(email) values ('att-block-a@example.invalid'),('att-block-b@example.invalid'),('att-block-x@example.invalid') returning id`)).rows.map(r => r.id);
  await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`, [A, B]);
  const cv = (await as(A, `select create_conversation('Attachment blocks') c`))[0].c;
  const token = (await as(A, `select * from create_invitation($1,'parent')`, [cv]))[0].token;
  await as(B, `select accept_invitation($1)`, [token]);

  const flags = async (uid) => (await as(uid, `select get_my_attachment_blocks($1) s`, [cv]))[0].s;
  const rec = async (sender) => (await as(sender, `select recipient_attachment_blocks($1) s`, [cv]))[0].s;
  const recSvc = async (sender) => (await svc(`select recipient_attachment_blocks($1,$2) s`, [cv, sender]))[0].s;

  const attach = async (sender, mime, key) => {
    const mid = (await db.query(
      `insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key) values ($1,$2,'vedhæftet',encode(extensions.digest('vedhæftet','sha256'),'hex'),$3) returning id`,
      [cv, sender, key]
    )).rows[0].id;
    await db.query(
      `insert into message_attachments(message_id,mime,name,size,pages,data) values ($1,$2,$3,4,1,decode('89504e470d0a','hex'))`,
      [mid, mime, mime === 'application/pdf' ? 'dokument.pdf' : 'foto.png']
    );
    return mid;
  };

  await t('Attachment blocks: default off, only owner sees own row, outsider cannot set', async () => {
    assert.deepEqual(await flags(A), { block_photos: false, block_files: false });
    assert.deepEqual(await flags(B), { block_photos: false, block_files: false });
    assert.deepEqual(await rec(A), { block_photos: false, block_files: false });
    await assert.rejects(as(X, `select get_my_attachment_blocks($1)`, [cv]), /not_member/);
    await assert.rejects(as(X, `select set_my_attachment_blocks($1,true,false)`, [cv]), /not_member/);
    await assert.rejects(as(A, `select recipient_attachment_blocks($1,$2)`, [cv, B]), /not_authorized/);
  });

  await t('Attachment blocks: B blocks photos; A cannot insert image but can insert PDF; own toggle does not block own send', async () => {
    const after = (await as(B, `select set_my_attachment_blocks($1,true,false) s`, [cv]))[0].s;
    assert.deepEqual(after, { block_photos: true, block_files: false });
    assert.deepEqual(await rec(A), { block_photos: true, block_files: false });
    assert.deepEqual(await recSvc(A), { block_photos: true, block_files: false });
    // A's own off flags must not appear as a recipient block to B
    assert.deepEqual(await rec(B), { block_photos: false, block_files: false });
    await assert.rejects(attach(A, 'image/png', 'att-photo-blocked'), /blocked_photos/);
    await attach(A, 'application/pdf', 'att-pdf-ok');
    await attach(B, 'image/png', 'att-own-photo-ok');
    assert.equal((await as(A, `select * from conversation_attachment_blocks`)).length, 0);
    assert.equal((await as(B, `select block_photos,block_files from conversation_attachment_blocks`)).length, 1);
    assert.equal((await as(X, `select * from conversation_attachment_blocks`)).length, 0);
  });

  await t('Attachment blocks: B blocks files; PDF rejected, photo allowed; left member no longer applies', async () => {
    await as(B, `select set_my_attachment_blocks($1,false,true)`, [cv]);
    assert.deepEqual(await rec(A), { block_photos: false, block_files: true });
    await assert.rejects(attach(A, 'application/pdf', 'att-pdf-blocked'), /blocked_files/);
    await attach(A, 'image/jpeg', 'att-jpeg-ok');
    await as(B, `select leave_conversation($1)`, [cv]);
    assert.deepEqual(await rec(A), { block_photos: false, block_files: false });
    await attach(A, 'application/pdf', 'att-pdf-after-leave');
  });

  await t('Attachment blocks: personal export includes only own settings', async () => {
    const cv2 = (await as(A, `select create_conversation('Export attach') c`))[0].c;
    const tok = (await as(A, `select * from create_invitation($1,'parent')`, [cv2]))[0].token;
    await as(B, `select accept_invitation($1)`, [tok]);
    await as(B, `select set_my_attachment_blocks($1,true,true)`, [cv2]);
    await as(A, `select set_my_attachment_blocks($1,false,true)`, [cv2]);
    const own = (await svc(`select export_user_data($1) r`, [B]))[0].r;
    const other = (await svc(`select export_user_data($1) r`, [A]))[0].r;
    assert.ok(own.own_attachment_blocks.some(x => x.conversation_id === cv2 && x.block_photos === true && x.block_files === true));
    assert.ok(!own.own_attachment_blocks.some(x => x.conversation_id === cv2 && x.user_id));
    assert.ok(other.own_attachment_blocks.some(x => x.conversation_id === cv2 && x.block_photos === false && x.block_files === true));
    assert.ok(!other.own_attachment_blocks.some(x => x.block_photos === true));
  });
}
