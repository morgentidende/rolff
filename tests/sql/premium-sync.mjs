// Sky-synk is Premium-only; a downgrade turns it off. No real accounts are deleted.
export async function testPremiumSyncNoInactivity({ db, as, svc, t, assert, rejects }) {
  const mk = async (email) => (await db.query(`insert into auth.users(email) values ($1) returning id`, [email])).rows[0].id;
  const Prem = await mk('sync-prem@test.invalid');
  const Std = await mk('sync-std@test.invalid');
  const Later = await mk('sync-later@test.invalid');

  await t('cloud sync: Standard cannot enable sky-synk (RPC)', async () => {
    await as(Std, `select * from get_my_plan()`);
    await rejects(as(Std, `select set_my_data_prefs(true,'1y')`), /plan_required/);
    assert.equal((await as(Std, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, false);
  });

  await t('cloud sync: trigger rejects a direct enable without Premium', async () => {
    await as(Std, `select * from get_my_privacy()`);
    await rejects(svc(`update user_privacy set cloud_sync = true where user_id=$1`, [Std]), /plan_required/);
  });

  await t('cloud sync: Premium can enable, and turning off is always allowed', async () => {
    await as(Prem, `select * from set_my_plan_test('text_attachments')`);
    await as(Prem, `select set_my_data_prefs(true,'5y')`);
    const on = (await as(Prem, `select cloud_sync, retention from get_my_privacy()`))[0];
    assert.equal(on.cloud_sync, true);
    assert.equal(on.retention, '5y');
    await as(Prem, `select set_my_data_prefs(false,'5y')`);
    assert.equal((await as(Prem, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, false);
    await as(Prem, `select set_my_data_prefs(true,'5y')`);
  });

  await t('cloud sync: immediate test downgrade turns sync off', async () => {
    assert.equal((await as(Prem, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, true);
    await as(Prem, `select * from set_my_plan_test('text', true)`);
    assert.equal((await as(Prem, `select plan from get_my_plan()`))[0].plan, 'text');
    assert.equal((await as(Prem, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, false);
    await rejects(as(Prem, `select set_my_data_prefs(true,'5y')`), /plan_required/);
  });

  await t('cloud sync: pending downgrade keeps sync until period end, then turns it off', async () => {
    await as(Later, `select * from set_my_plan_test('text_attachments')`);
    await as(Later, `select set_my_data_prefs(true,'1y')`);
    await as(Later, `select * from set_my_plan_test('text')`);
    const mid = (await as(Later, `select plan, pending_plan from get_my_plan()`))[0];
    assert.equal(mid.plan, 'text_attachments');
    assert.equal(mid.pending_plan, 'text');
    assert.equal((await as(Later, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, true, 'still Premium until period end');
    await db.query(`update user_plans set period_end = now() - interval '1 second' where user_id=$1`, [Later]);
    assert.equal((await as(Later, `select plan, pending_plan from get_my_plan()`))[0].plan, 'text');
    assert.equal((await as(Later, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, false);
  });

  await t('cloud sync: cancel-to-free at period end also turns sync off', async () => {
    const C = await mk('sync-cancel@test.invalid');
    await as(C, `select * from set_my_plan_test('text_attachments')`);
    await as(C, `select set_my_data_prefs(true,'1y')`);
    await as(C, `select * from cancel_my_subscription()`);
    assert.equal((await as(C, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, true);
    await db.query(`update user_plans set period_end = now() - interval '1 second' where user_id=$1`, [C]);
    assert.equal((await as(C, `select plan from get_my_plan()`))[0].plan, 'free');
    assert.equal((await as(C, `select cloud_sync from get_my_privacy()`))[0].cloud_sync, false);
  });
}
