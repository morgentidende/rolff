// Edit-hold for delayed messages: "Ret" pauses the countdown on the server.
// Synthetic data only. A held message (deliver_after = 'infinity') is never delivered by any path.
export async function testDelayedEditHold({ db, as, svc, hash, t, assert, rejects }) {
  const [S, R, Z] = (await db.query(`insert into auth.users(email) values ('hold-s@example.invalid'),('hold-r@example.invalid'),('hold-z@example.invalid') returning id`)).rows.map((r) => r.id);
  await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text_attachments')`, [S, R]);
  const conv = (await as(S, `select create_conversation('Hold') c`))[0].c;
  const token = (await as(S, `select * from create_invitation($1,'parent')`, [conv]))[0].token;
  await as(R, `select accept_invitation($1)`, [token]);
  await as(S, `select set_delayed_send($1,true)`, [conv]);

  const send = async (body, key) => {
    const aid = (await svc(`select test_issue_current_approval($1,$2,$3,'test','hold',null) id`, [S, conv, await hash(body)]))[0].id;
    return (await svc(`select * from commit_message_reply($1,$2,$3,$4,$5,null)`, [aid, S, conv, body, key]))[0].message_id;
  };
  const edit = async (mid, body) => {
    const aid = (await svc(`select test_issue_current_approval($1,$2,$3,'test','hold',null) id`, [S, conv, await hash(body)]))[0].id;
    return svc(`select * from update_delayed_message($1,$2,$3,$4)`, [aid, S, mid, body]);
  };
  const row = async (mid) => (await db.query(`select body, deliver_after, deliver_after = 'infinity' as held, deliver_after > clock_timestamp() as pending, extract(epoch from (deliver_after - clock_timestamp())) as secs from messages where id=$1`, [mid])).rows[0];
  const recvBodies = async () => (await as(R, `select body from get_messages_v3($1)`, [conv])).map((m) => m.body);
  const jobs = async () => (await db.query(`select count(*)::int n from notification_jobs where user_id=$1`, [R])).rows[0].n;
  const released = async (mid) => (await db.query(`select count(*)::int n from message_deliveries where message_id=$1 and released_at is not null`, [mid])).rows[0].n;
  // Every way a message can reach the recipient, none may deliver a held message.
  const tryEveryDeliveryPath = async () => {
    await svc(`select push_release_tick()`);
    await as(R, `select receive_now()`);
    await db.query(`select public._release_for($1, true)`, [R]);
    await db.query(`select public._release_for($1, false)`, [R]);
    await as(R, `select * from get_messages_v3($1)`, [conv]);
  };

  await t('Hold: Ret sætter den tællende besked på pause på serveren (held, ingen nedtælling)', async () => {
    const mid = await send('Godmorgen hej', 'hold-key-001');
    assert.equal((await row(mid)).pending, true);
    assert.equal((await as(S, `select hold_delayed_message($1) ok`, [mid]))[0].ok, true);
    const r = await row(mid);
    assert.equal(r.held, true);
    const mine = (await as(S, `select * from get_messages_v3($1)`, [conv])).find((m) => m.id === mid);
    assert.equal(mine.held, true);
    assert.equal(mine.deliver_after, null);
    assert.equal(mine.body, 'Godmorgen hej');
    // Idempotent.
    assert.equal((await as(S, `select hold_delayed_message($1) ok`, [mid]))[0].ok, true);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });

  await t('Hold: originalen leveres ALDRIG mens den er holdt, heller ikke når resttiden er gået og alle leveringsveje prøves', async () => {
    const mid = await send('Hold mig tilbage', 'hold-key-002');
    await db.query(`update messages set deliver_after = clock_timestamp() + interval '1 second' where id=$1`, [mid]);
    const j0 = await jobs();
    await as(S, `select hold_delayed_message($1)`, [mid]);
    await new Promise((r) => setTimeout(r, 1500)); // the old deadline has passed
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    assert.equal((await recvBodies()).includes('Hold mig tilbage'), false);
    assert.equal((await as(R, `select my_pending_count() n`))[0].n, 0);
    assert.equal(await jobs(), j0);
    assert.equal((await row(mid)).held, true);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });

  await t('Hold: "Send nu" kan ikke tilsidesætte en pause', async () => {
    const mid = await send('Ikke endnu', 'hold-key-003');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    await rejects(as(S, `select release_delayed_message($1)`, [mid]), /held/);
    assert.equal(await released(mid), 0);
    assert.equal((await row(mid)).held, true);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });

  await t('Hold: kun afsenderen kan holde; fremmede og andre medlemmer afvises', async () => {
    const mid = await send('Kun min', 'hold-key-004');
    await rejects(as(R, `select hold_delayed_message($1)`, [mid]), /not_found/);
    await rejects(as(Z, `select hold_delayed_message($1)`, [mid]), /not_found/);
    await rejects(as(R, `select resume_delayed_message($1)`, [mid]), /not_found/);
    assert.equal((await row(mid)).held, false);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });

  await t('Race: allerede leveret når Ret trykkes -> afvist (no_longer_pending), teksten er uændret', async () => {
    const mid = await send('Allerede sendt', 'hold-key-005');
    assert.equal((await as(S, `select release_delayed_message($1) ok`, [mid]))[0].ok, true);
    assert.ok((await recvBodies()).includes('Allerede sendt'));
    await rejects(as(S, `select hold_delayed_message($1)`, [mid]), /no_longer_pending/);
    await rejects(edit(mid, 'Rettet efter levering'), /no_longer_pending/);
    await rejects(as(S, `select resume_delayed_message($1)`, [mid]), /no_longer_pending/);
    assert.equal((await row(mid)).body, 'Allerede sendt');
    assert.equal((await row(mid)).held, false);
  });

  await t('Race: nedtællingen udløb lige før Ret (due, men ikke frigivet endnu) -> afvist og ikke holdt', async () => {
    const mid = await send('Lige udløbet', 'hold-key-006');
    await db.query(`update messages set deliver_after = clock_timestamp() - interval '1 second' where id=$1`, [mid]);
    await rejects(as(S, `select hold_delayed_message($1)`, [mid]), /no_longer_pending/);
    assert.equal((await row(mid)).held, false);
    await as(R, `select receive_now()`);
    assert.ok((await recvBodies()).includes('Lige udløbet'));
  });

  await t('Gem rettelse: ny moderering kræves, ny fuld forsinkelse (30 s) med den nye tekst, originalen når aldrig frem', async () => {
    const mid = await send('Original tekst', 'hold-key-007');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    // Moderation must run on the edited text: no/foreign/expired approval is refused and the message stays held.
    await rejects(svc(`select * from update_delayed_message(gen_random_uuid(),$1,$2,'Ikke godkendt')`, [S, mid]), /approval_invalid/);
    assert.equal((await row(mid)).held, true);
    assert.equal((await row(mid)).body, 'Original tekst');
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    const r = await edit(mid, 'Rettet tekst');
    assert.equal(r[0].message_id, mid);
    const after = await row(mid);
    assert.equal(after.body, 'Rettet tekst');
    assert.equal(after.held, false);
    assert.equal(after.pending, true);
    assert.ok(after.secs > 28 && after.secs <= 30.5, 'fresh full delay, got ' + after.secs);
    assert.equal((await as(S, `select * from get_messages_v3($1)`, [conv])).find((m) => m.id === mid).held, false);
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    await db.query(`update messages set deliver_after = clock_timestamp() - interval '1 second' where id=$1`, [mid]);
    await as(R, `select receive_now()`);
    const bodies = await recvBodies();
    assert.ok(bodies.includes('Rettet tekst'));
    assert.equal(bodies.includes('Original tekst'), false);
  });

  await t('Gem rettelse: afvist/blokeret tekst (ingen godkendelse) lader beskeden forblive holdt, ikke leveret', async () => {
    const mid = await send('Skal rettes', 'hold-key-008');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    // An approval issued for a different text cannot be used for the edited text.
    const aid = (await svc(`select test_issue_current_approval($1,$2,$3,'test','hold',null) id`, [S, conv, await hash('Helt anden tekst')]))[0].id;
    await rejects(svc(`select * from update_delayed_message($1,$2,$3,'Rettet men ikke modereret')`, [aid, S, mid]), /approval_invalid/);
    assert.equal((await row(mid)).held, true);
    assert.equal((await row(mid)).body, 'Skal rettes');
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });

  await t('Annullér rettelse (X): genoptag giver en ny fuld forsinkelse med den uændrede original', async () => {
    const mid = await send('Uændret original', 'hold-key-009');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    const due = (await as(S, `select resume_delayed_message($1) due`, [mid]))[0].due;
    const r = await row(mid);
    assert.equal(r.held, false);
    assert.equal(r.body, 'Uændret original');
    assert.ok(r.secs > 28 && r.secs <= 30.5, 'fresh full delay, got ' + r.secs);
    assert.ok(new Date(due) > new Date());
    // Still hidden during the fresh delay; idempotent resume keeps the same deadline.
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    assert.equal(new Date((await as(S, `select resume_delayed_message($1) due`, [mid]))[0].due).getTime(), new Date(due).getTime());
    const mine = (await as(S, `select * from get_messages_v3($1)`, [conv])).find((m) => m.id === mid);
    assert.equal(mine.held, false);
    assert.ok(mine.deliver_after);
    await db.query(`update messages set deliver_after = clock_timestamp() - interval '1 second' where id=$1`, [mid]);
    await as(R, `select receive_now()`);
    assert.ok((await recvBodies()).includes('Uændret original'));
  });

  await t('Slet virker mens beskeden er holdt; modtageren ser aldrig noget', async () => {
    const mid = await send('Slettes under pause', 'hold-key-010');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
    assert.equal((await db.query(`select count(*)::int n from messages where id=$1`, [mid])).rows[0].n, 0);
    assert.equal((await recvBodies()).includes('Slettes under pause'), false);
  });

  await t('En holdt besked kan ikke besvares og tæller ikke som leveret; ingen auto-genoptagelse', async () => {
    const mid = await send('Hænger på pause', 'hold-key-011');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    await db.query(`update messages set created_at = created_at - interval '3 days' where id=$1`, [mid]);
    await tryEveryDeliveryPath();
    assert.equal(await released(mid), 0);
    assert.equal((await row(mid)).held, true);
    assert.equal((await db.query(`select _delayed_pending($1) p`, [mid])).rows[0].p, true);
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });

  await t('get_messages_v2 uændret: modtageren ser aldrig held/deliver_after', async () => {
    const mid = await send('Skjult', 'hold-key-012');
    await as(S, `select hold_delayed_message($1)`, [mid]);
    assert.equal((await as(R, `select * from get_messages_v2($1)`, [conv])).some((m) => m.id === mid), false);
    const v3 = await as(R, `select * from get_messages_v3($1)`, [conv]);
    assert.equal(v3.some((m) => m.id === mid), false);
    assert.ok(v3.every((m) => m.held === false));
    await as(S, `select cancel_delayed_message($1)`, [mid]);
  });
}
