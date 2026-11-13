// Migration 20261113090000_message_thumbs: a fixed 👍 reaction, not a text message.
export async function testMessageThumbs({ db, as, svc, hash, t, assert, rejects }) {
  const send = async (from, conv, text, key) => {
    const id = (await svc(`select test_issue_current_approval($1,$2,$3,'test','m') id`, [from, conv, await hash(text)]))[0].id;
    return svc(`select * from commit_message($1,$2,$3,$4,$5)`, [id, from, conv, text, key]);
  };

  const [A, B, R, X] = (await db.query(`insert into auth.users(email) values
    ('thumb-a@example.invalid'),('thumb-b@example.invalid'),('thumb-r@example.invalid'),('thumb-x@example.invalid') returning id`)).rows.map(r => r.id);
  await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments'),($3,'text_attachments') on conflict (user_id) do update set plan='text_attachments'`, [A, B, R]);
  const conv = (await as(A, `select create_conversation('Thumbs') c`))[0].c;
  const token = (await as(A, `select * from create_invitation($1,'parent')`, [conv]))[0].token;
  await as(B, `select accept_invitation($1)`, [token]);
  const mid = (await send(A, conv, 'Kan vi mødes kl. 16?', 'thumb-msg-0001'))[0].message_id;
  // Release to B so B can see and react.
  await db.query(`select public._release_for($1, true)`, [B]);

  await t('👍: A og B kan sætte og fjerne; begge ser tællingen; kun én pr. bruger', async () => {
    const addA = (await as(A, `select * from toggle_message_thumb($1)`, [mid]))[0];
    assert.equal(addA.i_thumbed, true);
    assert.equal(addA.thumb_count, 1);
    const addB = (await as(B, `select * from toggle_message_thumb($1)`, [mid]))[0];
    assert.equal(addB.i_thumbed, true);
    assert.equal(addB.thumb_count, 2);
    const againA = (await as(A, `select * from toggle_message_thumb($1)`, [mid]))[0];
    // Second toggle by A removes only A's 👍.
    assert.equal(againA.i_thumbed, false);
    assert.equal(againA.thumb_count, 1);
    const seen = (await as(B, `select * from get_messages_v3($1)`, [conv])).find(m => m.id === mid);
    assert.equal(seen.thumb_count, 1);
    assert.equal(seen.i_thumbed, true);
    const seenA = (await as(A, `select * from get_messages_v3($1)`, [conv])).find(m => m.id === mid);
    assert.equal(seenA.thumb_count, 1);
    assert.equal(seenA.i_thumbed, false);
    // get_messages_v2 is unchanged (no thumb columns).
    const v2 = (await as(A, `select * from get_messages_v2($1)`, [conv])).find(m => m.id === mid);
    assert.ok(!('thumb_count' in v2));
    assert.ok(!('i_thumbed' in v2));
  });

  await t('👍: check constraint og RPC tillader kun 👍; anden emoji afvises', async () => {
    await rejects(svc(`insert into message_reactions(message_id,user_id,emoji) values ($1,$2,'👎')`, [mid, A]), /message_reactions_emoji_check|check constraint/i);
    await rejects(svc(`insert into message_reactions(message_id,user_id,emoji) values ($1,$2,'👍️')`, [mid, A]), /message_reactions_emoji_check|check constraint/i);
    // Put A's 👍 back via the only public write path, then unique key holds.
    const back = (await as(A, `select * from toggle_message_thumb($1)`, [mid]))[0];
    assert.equal(back.i_thumbed, true);
    await rejects(svc(`insert into message_reactions(message_id,user_id,emoji) values ($1,$2,'👍')`, [mid, A]), /duplicate key|unique/i);
  });

  await t('👍: uvedkommende og direkte tabeladgang er afvist', async () => {
    await rejects(as(X, `select * from toggle_message_thumb($1)`, [mid]), /not_member|invalid_message/);
    await rejects(as(X, `select * from get_messages_v3($1)`, [conv]), /not_member/);
    await rejects(as(A, `select * from message_reactions`), /permission denied/);
    await rejects(as(A, `insert into message_reactions(message_id,user_id,emoji) values ($1,$2,'👍')`, [mid, A]), /permission denied/);
    await rejects(as(A, `delete from message_reactions where message_id=$1`, [mid]), /permission denied/);
  });

  await t('👍: ukendt eller ikke-synlig besked afvises; læser kan ikke sætte', async () => {
    await rejects(as(A, `select * from toggle_message_thumb(gen_random_uuid())`), /invalid_message/);
    const inv = (await as(A, `select * from create_member_invitation($1,'thumb-r@example.invalid','reader')`, [conv]))[0];
    const done = (await as(B, `select * from consent_member_invitation($1)`, [inv.invitation_id]))[0];
    assert.equal(done.complete, true);
    await as(R, `select accept_invitation($1)`, [done.token]);
    // Readers see no history from before they joined; send a new visible message.
    const later = (await send(A, conv, 'Ny besked til læseren', 'thumb-reader-0004'))[0].message_id;
    await db.query(`select public._release_for($1, true)`, [R]);
    await db.query(`select public._release_for($1, true)`, [B]);
    await rejects(as(R, `select * from toggle_message_thumb($1)`, [later]), /read_only/);
    const seenR = (await as(R, `select * from get_messages_v3($1)`, [conv])).find(m => m.id === later);
    assert.ok(seenR);
    assert.equal(seenR.i_thumbed, false);
    assert.equal(seenR.thumb_count, 0);
  });

  await t('👍: blokeret samtale forhindrer at sætte, men eget 👍 kan fjernes', async () => {
    await as(A, `select unblock_conversation($1)`, [conv]);
    // Known state: only B has a 👍.
    const stateA = (await as(A, `select * from get_messages_v3($1)`, [conv])).find(m => m.id === mid);
    if (stateA.i_thumbed) await as(A, `select * from toggle_message_thumb($1)`, [mid]);
    const stateB = (await as(B, `select * from get_messages_v3($1)`, [conv])).find(m => m.id === mid);
    if (!stateB.i_thumbed) await as(B, `select * from toggle_message_thumb($1)`, [mid]);
    await as(A, `select block_conversation($1)`, [conv]);
    const removed = (await as(B, `select * from toggle_message_thumb($1)`, [mid]))[0];
    assert.equal(removed.i_thumbed, false);
    await rejects(as(B, `select * from toggle_message_thumb($1)`, [mid]), /cannot_deliver/);
    // A can still add (the block is A's, same rule as sending).
    const aAdd = (await as(A, `select * from toggle_message_thumb($1)`, [mid]))[0];
    assert.equal(aAdd.i_thumbed, true);
    await as(A, `select unblock_conversation($1)`, [conv]);
  });

  await t('👍: ikke-frigivet besked er usynlig for modtageren; eksport tæller 👍', async () => {
    await as(A, `select unblock_conversation($1)`, [conv]);
    await db.query(`insert into receive_settings(user_id,timezone,enabled) values ($1,'Europe/Copenhagen',true) on conflict (user_id) do update set enabled=true`, [B]);
    const pending = (await send(A, conv, 'Venter i vindue', 'thumb-pend-0002'))[0].message_id;
    await rejects(as(B, `select * from toggle_message_thumb($1)`, [pending]), /invalid_message/);
    assert.equal((await as(B, `select * from get_messages_v3($1)`, [conv])).some(m => m.id === pending), false);
    const exp = (await svc(`select id, thumb_count from get_export_messages($1,$2,null,null)`, [A, conv])).find(m => m.id === mid);
    assert.ok(exp && exp.thumb_count >= 1);
    const expPending = (await svc(`select id, thumb_count from get_export_messages($1,$2,null,null)`, [B, conv])).find(m => m.id === pending);
    assert.equal(expPending, undefined);
    await db.query(`update receive_settings set enabled=false where user_id=$1`, [B]);
  });

  await t('👍: sletning af besked eller bruger fjerner reaktionen', async () => {
    await as(A, `select unblock_conversation($1)`, [conv]);
    await db.query(`update receive_settings set enabled=false where user_id=$1`, [B]);
    const extra = (await send(A, conv, 'Slettes igen', 'thumb-del-0003'))[0].message_id;
    await db.query(`select public._release_for($1, true)`, [B]);
    await as(B, `select * from toggle_message_thumb($1)`, [extra]);
    assert.equal((await svc(`select count(*)::int n from message_reactions where message_id=$1`, [extra]))[0].n, 1);
    await db.query(`delete from messages where id=$1`, [extra]);
    assert.equal((await svc(`select count(*)::int n from message_reactions where message_id=$1`, [extra]))[0].n, 0);
  });
}
