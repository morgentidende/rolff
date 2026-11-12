// Migration 20261112200000_app_locale: set_my_locale for the signed-in user; service-role lookups.
export async function testAppLocale({ db, as, svc, t, assert, rejects }) {
  const [U, V] = (await db.query(`insert into auth.users(email) values ('loc-a@example.invalid'),('loc-b@example.invalid') returning id`)).rows.map(r => r.id);
  await t('App-sprog: ny profil er da', async () => {
    assert.equal((await as(U, `select locale from profiles where user_id=$1`, [U]))[0].locale, 'da');
  });
  await t('App-sprog: set_my_locale gemmer en og rører ikke andres', async () => {
    assert.equal((await as(U, `select set_my_locale('en') loc`))[0].loc, 'en');
    assert.equal((await as(U, `select locale from profiles where user_id=$1`, [U]))[0].locale, 'en');
    assert.equal((await as(V, `select locale from profiles where user_id=$1`, [V]))[0].locale, 'da');
    assert.equal((await as(U, `select set_my_locale('da') loc`))[0].loc, 'da');
    assert.equal((await as(U, `select set_my_locale('en') loc`))[0].loc, 'en');
  });
  await t('App-sprog: set_my_locale afviser ugyldigt sprog og uindlogget', async () => {
    await rejects(as(U, `select set_my_locale('fr')`), /bad_input/);
    await rejects(as(U, `select set_my_locale(null)`), /bad_input/);
    await rejects(db.query(`select set_my_locale('en')`), /unauthenticated/);
  });
  await t('App-sprog: locale_of og locale_for_email er kun service_role', async () => {
    assert.equal((await svc(`select locale_of($1) l`, [U]))[0].l, 'en');
    assert.equal((await svc(`select locale_of($1) l`, [V]))[0].l, 'da');
    assert.equal((await svc(`select locale_for_email('loc-a@example.invalid') l`))[0].l, 'en');
    assert.equal((await svc(`select locale_for_email('nobody@example.invalid') l`))[0].l, null);
    await rejects(as(U, `select locale_for_email('loc-a@example.invalid')`));
    await rejects(as(U, `select locale_of($1)`, [U]));
  });
  await t('App-sprog: migration er idempotent', async () => {
    const fs = await import('node:fs');
    await db.exec(fs.readFileSync('../../supabase/migrations/20261112200000_app_locale.sql', 'utf8'));
    assert.equal((await as(U, `select set_my_locale('en') loc`))[0].loc, 'en');
  });
}
