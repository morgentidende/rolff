// Opsig/genoptag abonnement: pending_plan = 'free' until period end; account and data stay.
export async function testCancelSubscription({ db, as, svc, t, assert, rejects }) {
  const mk = async (email) => (await db.query(`insert into auth.users(email) values ($1) returning id`, [email])).rows[0].id;
  const A = await mk('cancel-sub-a@test.invalid');
  const B = await mk('cancel-sub-b@test.invalid');

  await t('cancel subscription: unauthenticated is refused', async () => {
    await rejects(db.query(`select * from cancel_my_subscription()`), /unauthenticated|42501|permission|denied/);
    await rejects(db.query(`select * from resume_my_subscription()`), /unauthenticated|42501|permission|denied/);
  });

  await t('cancel subscription: paid plan stays until period end, then becomes free', async () => {
    const before = (await as(A, `select plan, pending_plan from get_my_plan()`))[0];
    assert.equal(before.plan, 'text');
    assert.equal(before.pending_plan, null);
    const r = (await as(A, `select plan, pending_plan, period_end from cancel_my_subscription()`))[0];
    assert.equal(r.plan, 'text');
    assert.equal(r.pending_plan, 'free');
    assert.ok(r.period_end);
    assert.equal((await svc(`select message_char_limit($1) n`, [A]))[0].n, 160);
    const again = (await as(A, `select pending_plan from cancel_my_subscription()`))[0];
    assert.equal(again.pending_plan, 'free', 'idempotent while already cancelling');
  });

  await t('resume subscription: clears pending free and keeps the paid plan', async () => {
    const r = (await as(A, `select plan, pending_plan from resume_my_subscription()`))[0];
    assert.equal(r.plan, 'text');
    assert.equal(r.pending_plan, null);
    await rejects(as(A, `select * from resume_my_subscription()`), /not_cancelling/);
  });

  await t('set_my_plan_test cannot switch to free; cancel is the only path', async () => {
    await rejects(as(A, `select * from set_my_plan_test('free')`), /bad_plan/);
  });

  await t('cancel subscription: at period end the plan becomes free and attachments are refused', async () => {
    await as(B, `select * from set_my_plan_test('text_attachments')`);
    assert.equal((await svc(`select message_char_limit($1) n`, [B]))[0].n, 480);
    await as(B, `select * from cancel_my_subscription()`);
    assert.equal((await as(B, `select plan from get_my_plan()`))[0].plan, 'text_attachments', 'still paid until period end');
    await db.query(`update user_plans set period_end = now() - interval '1 second' where user_id = $1`, [B]);
    const after = (await as(B, `select plan, pending_plan from get_my_plan()`))[0];
    assert.equal(after.plan, 'free');
    assert.equal(after.pending_plan, null);
    assert.equal((await svc(`select message_char_limit($1) n`, [B]))[0].n, 160);
    await rejects(as(B, `select * from cancel_my_subscription()`), /not_subscribed/);
    await rejects(as(B, `select * from resume_my_subscription()`), /not_cancelling/);
  });
}
