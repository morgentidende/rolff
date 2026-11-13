// Optional 30-second delayed send: preference, visibility, edit/cancel, send-now, notifications.
export async function testDelayedMessages({ db, as, svc, hash, t, assert, rejects }) {
  const [S, R, Z] = (await db.query(`insert into auth.users(email) values ('delay-s@example.invalid'),('delay-r@example.invalid'),('delay-z@example.invalid') returning id`)).rows.map((r) => r.id);
  await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`, [S, R]);
  const conv = (await as(S, `select create_conversation('Delayed') c`))[0].c;
  const token = (await as(S, `select * from create_invitation($1,'parent')`, [conv]))[0].token;
  await as(R, `select accept_invitation($1)`, [token]);

  const send = async (uid, body, key) => {
    const aid = (await svc(`select test_issue_current_approval($1,$2,$3,'test','delayed',null) id`, [uid, conv, await hash(body)]))[0].id;
    return svc(`select * from commit_message_reply($1,$2,$3,$4,$5,null)`, [aid, uid, conv, body, key]);
  };

  await t('Delayed: slået fra som standard og gemmes per bruger per samtale', async () => {
    assert.equal((await as(S, `select delayed_send_enabled($1) enabled`, [conv]))[0].enabled, false);
    assert.equal((await as(S, `select set_delayed_send($1,true) enabled`, [conv]))[0].enabled, true);
    assert.equal((await as(S, `select delayed_send_enabled($1) enabled`, [conv]))[0].enabled, true);
    assert.equal((await as(R, `select delayed_send_enabled($1) enabled`, [conv]))[0].enabled, false);
  });

  await t('Delayed: uvedkommende og læserrolle kan ikke slå det til', async () => {
    await rejects(as(Z, `select delayed_send_enabled($1)`, [conv]), /not_member/);
    await rejects(as(Z, `select set_delayed_send($1,true)`, [conv]), /not_member/);
    await db.query(`update memberships set role='reader' where conversation_id=$1 and user_id=$2`, [conv, R]);
    await rejects(as(R, `select set_delayed_send($1,true)`, [conv]), /read_only/);
    await db.query(`update memberships set role='parent' where conversation_id=$1 and user_id=$2`, [conv, R]);
  });

  let mid;
  await t('Delayed: holdt besked er usynlig for modtageren og tæller ikke i deres ventekø', async () => {
    const jobsBefore = (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
    mid = (await send(S, 'Jeg henter kl. 16.', 'delay-key-001'))[0].message_id;
    const held = (await db.query(`select deliver_after > clock_timestamp() as pending from messages where id=$1`, [mid])).rows[0];
    assert.equal(held.pending, true);
    const forS = await as(S, `select * from get_messages_v2($1)`, [conv]);
    const mine = forS.find((m) => m.id === mid);
    assert.ok(mine);
    assert.equal(mine.body, 'Jeg henter kl. 16.');
    assert.ok(mine.deliver_after);
    const forR = await as(R, `select * from get_messages_v2($1)`, [conv]);
    assert.equal(forR.some((m) => m.id === mid), false);
    assert.equal((await as(R, `select my_pending_count() n`))[0].n, 0);
    const jobsAfter = (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
    assert.equal(jobsAfter, jobsBefore);
    // Existing minute worker must also refuse to release early.
    await svc(`select push_release_tick()`);
    assert.equal((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === mid), false);
  });

  await t('Delayed: Receive now må ikke udlevere en besked inden 30 sekunder', async () => {
    await as(R, `select receive_now()`);
    assert.equal((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === mid), false);
  });

  await t('Delayed: anden afsender kan ikke rette, slette eller sende nu', async () => {
    await rejects(as(R, `select release_delayed_message($1)`, [mid]), /not_found/);
    await rejects(as(R, `select cancel_delayed_message($1)`, [mid]), /no_longer_pending|not_found/);
    await rejects(svc(`select * from update_delayed_message(gen_random_uuid(),$1,$2,'Ny tekst')`, [R, mid]), /no_longer_pending/);
  });

  await t('Delayed: rettelse kræver ny godkendelse, skjules stadig og starter 30 s forfra', async () => {
    const before = (await db.query(`select deliver_after from messages where id=$1`, [mid])).rows[0].deliver_after;
    const body = 'Jeg henter kl. 17 i stedet.';
    const aid = (await svc(`select test_issue_current_approval($1,$2,$3,'test','delayed',null) id`, [S, conv, await hash(body)]))[0].id;
    const r = await svc(`select * from update_delayed_message($1,$2,$3,$4)`, [aid, S, mid, body]);
    assert.equal(r[0].message_id, mid);
    const row = (await db.query(`select body, deliver_after, edited_at from messages where id=$1`, [mid])).rows[0];
    assert.equal(row.body, body);
    assert.ok(row.edited_at);
    assert.ok(new Date(row.deliver_after) >= new Date(before));
    assert.equal((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === mid), false);
    assert.equal((await as(S, `select * from get_messages_v2($1)`, [conv])).find((m) => m.id === mid).body, body);
  });

  await t('Delayed: tryk på nedtælling sender med det samme via normal levering', async () => {
    const jobsBefore = (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
    assert.equal((await as(S, `select release_delayed_message($1) ok`, [mid]))[0].ok, true);
    const forR = await as(R, `select * from get_messages_v2($1)`, [conv]);
    const seen = forR.find((m) => m.id === mid);
    assert.ok(seen);
    assert.equal(seen.body, 'Jeg henter kl. 17 i stedet.');
    assert.equal(seen.deliver_after, null);
    assert.equal((await as(S, `select * from get_messages_v2($1)`, [conv])).find((m) => m.id === mid).deliver_after, null);
    const jobsAfter = (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
    assert.ok(jobsAfter > jobsBefore);
    // Idempotent once released.
    assert.equal((await as(S, `select release_delayed_message($1) ok`, [mid]))[0].ok, false);
    await rejects(as(S, `select cancel_delayed_message($1)`, [mid]), /no_longer_pending/);
  });

  await t('Delayed: slet inden levering fjerner beskeden for alle', async () => {
    const body = 'Denne skal slettes.';
    const id = (await send(S, body, 'delay-key-cancel'))[0].message_id;
    await as(S, `select cancel_delayed_message($1)`, [id]);
    assert.equal((await db.query(`select count(*)::int n from messages where id=$1`, [id])).rows[0].n, 0);
    assert.equal((await as(S, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === id), false);
    assert.equal((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === id), false);
  });

  await t('Delayed: når 30 s er gået, udleverer release-tick og opretter notifikationsjob', async () => {
    const body = 'Tiden er gået.';
    const id = (await send(S, body, 'delay-key-due'))[0].message_id;
    await db.query(`update messages set deliver_after = clock_timestamp() - interval '1 second' where id=$1`, [id]);
    const jobsBefore = (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
    assert.equal((await as(R, `select my_pending_count() n`))[0].n >= 1, true);
    const released = (await as(R, `select receive_now() n`))[0].n;
    assert.ok(released >= 1);
    assert.ok((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === id));
    const jobsAfter = (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
    assert.ok(jobsAfter > jobsBefore);
  });

  await t('Delayed: slået fra sender med det samme som før', async () => {
    await as(S, `select set_delayed_send($1,false)`, [conv]);
    const body = 'Ingen forsinkelse.';
    const id = (await send(S, body, 'delay-key-off'))[0].message_id;
    const row = (await db.query(`select deliver_after from messages where id=$1`, [id])).rows[0];
    assert.equal(row.deliver_after, null);
    assert.ok((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === id));
  });

  await t('Delayed: get_messages (gammel RPC) er uændret og afslører ikke deliver_after', async () => {
    const r = await as(S, `select * from get_messages($1)`, [conv]);
    assert.ok(r.length > 0);
    assert.equal('deliver_after' in r[0], false);
  });
}
