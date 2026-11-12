// Migration 20261112220000_push_device_tokens: native (FCM/APNs) tokens with a platform field.
export async function testPushDeviceTokens({ db, as, svc, t, assert, rejects }) {
  const [U, V] = (await db.query(`insert into auth.users(email) values ('pdt-a@example.invalid'),('pdt-b@example.invalid') returning id`)).rows.map(r => r.id);
  const tok = (c) => 'fcmTOKEN_' + c.repeat(40);
  let id;
  await t('Push-tokens: gemmer android/fcm og ios/apns med platform', async () => {
    id = (await as(U, `select save_my_device_token('android','fcm',$1) id`, [tok('a')]))[0].id;
    await as(U, `select save_my_device_token('ios','apns',$1)`, ['a1b2c3d4'.repeat(8)]);
    const rows = await as(U, `select platform from my_device_tokens() order by platform`);
    assert.deepEqual(rows.map(r => r.platform), ['android', 'ios']);
    assert.deepEqual(Object.keys((await as(U, `select * from my_device_tokens()`))[0]).sort(), ['created_at', 'expires_at', 'id', 'platform']);
  });
  await t('Push-tokens: afviser ugyldig platform/udbyder/token', async () => {
    await rejects(as(U, `select save_my_device_token('web','fcm',$1)`, [tok('b')]), /invalid_token/);
    await rejects(as(U, `select save_my_device_token('android','apns',$1)`, [tok('b')]), /invalid_token/);
    await rejects(as(U, `select save_my_device_token('android','fcm','kort')`), /invalid_token/);
    await rejects(as(U, `select save_my_device_token('android','fcm','bad token with spaces 123456')`), /invalid_token/);
  });
  await t('Push-tokens: en andens token overtages ikke, og tabellen kan ikke læses direkte', async () => {
    await rejects(as(V, `select save_my_device_token('android','fcm',$1)`, [tok('a')]), /token_conflict/);
    await rejects(as(V, `select * from push_device_tokens`), /permission denied/);
    assert.equal((await as(V, `select * from my_device_tokens()`)).length, 0);
    await rejects(db.query(`select save_my_device_token('android','fcm',$1)`, [tok('c')]), /unauthenticated/);
  });
  await t('Push-tokens: fornyelse erstatter, maks 8 enheder, tilbagekald', async () => {
    const renewed = (await as(U, `select save_my_device_token('android','fcm',$1,$2) id`, [tok('d'), id]))[0].id;
    assert.notEqual(renewed, id);
    assert.equal((await as(U, `select * from my_device_tokens()`)).length, 2);
    for (let i = 0; i < 6; i++) await as(U, `select save_my_device_token('android','fcm',$1)`, [tok(String(i))]);
    await rejects(as(U, `select save_my_device_token('android','fcm',$1)`, [tok('z')]), /device_limit/);
    await as(V, `select revoke_my_device_token($1)`, [renewed]);
    assert.equal((await as(U, `select * from my_device_tokens()`)).length, 8);
    await as(U, `select revoke_my_device_token($1)`, [renewed]);
    assert.equal((await as(U, `select * from my_device_tokens()`)).length, 7);
    await as(U, `select revoke_my_device_token(null, true)`);
    assert.equal((await as(U, `select * from my_device_tokens()`)).length, 0);
  });
  await t('Push-tokens: slettes med kontoen, og migrationen er idempotent', async () => {
    await as(V, `select save_my_device_token('android','fcm',$1)`, [tok('v')]);
    await db.query(`delete from auth.users where id=$1`, [V]);
    assert.equal((await svc(`select count(*)::int n from push_device_tokens where user_id=$1`, [V]))[0].n, 0);
    const fs = await import('node:fs');
    await db.exec(fs.readFileSync('../../supabase/migrations/20261112220000_push_device_tokens.sql', 'utf8'));
  });
}
