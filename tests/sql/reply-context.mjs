// Reply moderation context (reply_moderation_context). Synthetic users/messages only; no AI/network.
export async function testReplyContext({ db, as, svc, t, assert }) {
  const rejects = (p, re) => assert.rejects(p, re);
  const [A, B, X] = (await db.query(`insert into auth.users(email) values ('rc-a@example.invalid'),('rc-b@example.invalid'),('rc-x@example.invalid') returning id`)).rows.map(r => r.id);
  await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments'),($3,'text_attachments')`, [A, B, X]);
  const conv = async (members) => {
    const id = (await db.query(`insert into conversations(created_by) values($1) returning id`, [members[0]])).rows[0].id;
    for (const u of members) await db.query(`insert into memberships(conversation_id,user_id,role,joined_at) values($1,$2,'parent',now()-interval '30 days')`, [id, u]);
    return id;
  };
  let k = 0;
  const put = async (cv, sender, body, ago, released = true) => {
    const id = (await db.query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,created_at) values($1,$2,$3,'h',$4,now()-$5::interval) returning id`, [cv, sender, body, 'rc-key-' + (++k), ago])).rows[0].id;
    await db.query(`insert into message_deliveries(message_id,recipient_id,released_at) select $1,m.user_id,case when $3 then now() end from memberships m where m.conversation_id=$2 and m.user_id<>$4 and m.left_at is null`, [id, cv, released, sender]);
    return id;
  };
  const c = await conv([A, B]), other = await conv([A, X]);
  const old = await put(c, A, 'Gammel syntetisk besked om afhentning ' + 'x'.repeat(400), '5 days');
  for (let i = 0; i < 7; i++) await put(c, i % 2 ? A : B, 'Nyere syntetisk ' + i, `${10 - i} hours`);
  const recent = await put(c, B, 'Seneste syntetiske besked fra B', '1 hour');
  const ctxOf = async (sender, reply) => svc(`select * from reply_moderation_context($1,$2,$3)`, [sender, c, reply]);

  await t('Svar-kontekst: gammel besked uden for de 5 returneres kort med afsender og placering', async () => {
    const [r] = await ctxOf(B, old);
    assert.equal(r.mine, false); assert.equal([...r.body].length, 300); assert.ok(r.body.startsWith('Gammel syntetisk'));
    assert.equal(r.newer, 8);
    const [own] = await ctxOf(A, old); assert.equal(own.mine, true);
  });
  await t('Svar-kontekst: seneste besked har newer=0; null svar giver ingen rækker', async () => {
    const [r] = await ctxOf(A, recent); assert.equal(r.newer, 0); assert.equal(r.body, 'Seneste syntetiske besked fra B');
    assert.equal((await ctxOf(A, null)).length, 0);
  });
  await t('Svar-kontekst: kun server – anon og authenticated kan ikke kalde', async () => {
    await rejects(as(B, `select * from reply_moderation_context($1,$2,$3)`, [B, c, old]), /permission denied/);
    await rejects(db.transaction(async tx => { await tx.exec('set local role anon'); return tx.query(`select * from reply_moderation_context($1,$2,$3)`, [B, c, old]); }), /permission denied/);
  });
  await t('Svar-kontekst: lækker aldrig – anden samtale, ikke-medlem, uudleveret, før indmeldelse, læser', async () => {
    const elsewhere = await put(other, X, 'Hemmelig anden samtale', '2 hours');
    await rejects(ctxOf(A, elsewhere), /invalid_reply/);
    await rejects(svc(`select * from reply_moderation_context($1,$2,$3)`, [X, c, old]), /invalid_reply/);
    const held = await put(c, A, 'HEMMELIG ventende tekst', '30 minutes', false);
    await rejects(ctxOf(B, held), /invalid_reply/);
    const [own] = await ctxOf(A, held); assert.equal(own.mine, true);
    // a held message is not visible to B, so it must not count in B's position either
    assert.equal((await ctxOf(B, recent))[0].newer, 0);
    await db.query(`update memberships set joined_at=now()-interval '1 day' where conversation_id=$1 and user_id=$2`, [c, B]);
    await rejects(ctxOf(B, old), /invalid_reply/);
    await db.query(`update memberships set joined_at=now()-interval '30 days', role='reader' where conversation_id=$1 and user_id=$2`, [c, B]);
    await rejects(ctxOf(B, old), /invalid_reply/);
    await db.query(`update memberships set role='parent' where conversation_id=$1 and user_id=$2`, [c, B]);
  });
  await t('Svar-kontekst: retention gælder; slettet mål afvises', async () => {
    await db.query(`update messages set created_at=now()-interval '2 years' where id=$1`, [old]);
    await db.query(`update memberships set joined_at=now()-interval '3 years' where conversation_id=$1`, [c]);
    await as(B, `select set_my_data_prefs(false,'1y')`);
    await rejects(ctxOf(B, old), /invalid_reply/);
    await db.query(`delete from messages where id=$1`, [old]);
    await rejects(ctxOf(A, old), /invalid_reply/);
  });
}
