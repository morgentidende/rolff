// Signup metadata stamps ai_consent_at and age_confirmed_at; existing users stay null. Synthetic only.
export async function testSignupConsent({ db, as, svc, t, assert, rejects }) {
  const mk = async (email, meta) => (await db.query(
    `insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify(meta)],
  )).rows[0].id;

  await t('signup metadata: both flags set timestamps; export includes them', async () => {
    const id = await mk('consent-ok@test.invalid', { display_name: 'Consent Ok', ai_consent: true, age_18: true });
    const row = (await db.query(`select ai_consent_at, age_confirmed_at, display_name from profiles where user_id=$1`, [id])).rows[0];
    assert.ok(row.ai_consent_at, 'ai_consent_at');
    assert.ok(row.age_confirmed_at, 'age_confirmed_at');
    assert.equal(row.display_name, 'Consent Ok');
    const exp = (await svc(`select export_user_data($1) r`, [id]))[0].r;
    assert.ok(exp.profile.ai_consent_at);
    assert.ok(exp.profile.age_confirmed_at);
  });

  await t('signup metadata: missing flags leave timestamps null', async () => {
    const id = await mk('consent-none@test.invalid', { display_name: 'No Flags' });
    const row = (await db.query(`select ai_consent_at, age_confirmed_at from profiles where user_id=$1`, [id])).rows[0];
    assert.equal(row.ai_consent_at, null);
    assert.equal(row.age_confirmed_at, null);
  });

  await t('signup metadata: only one flag sets only that stamp', async () => {
    const a = await mk('consent-ai-only@test.invalid', { ai_consent: true });
    const b = await mk('consent-age-only@test.invalid', { age_18: 'yes' });
    const ra = (await db.query(`select ai_consent_at, age_confirmed_at from profiles where user_id=$1`, [a])).rows[0];
    const rb = (await db.query(`select ai_consent_at, age_confirmed_at from profiles where user_id=$1`, [b])).rows[0];
    assert.ok(ra.ai_consent_at); assert.equal(ra.age_confirmed_at, null);
    assert.equal(rb.ai_consent_at, null); assert.ok(rb.age_confirmed_at);
  });

  await t('authenticated user cannot overwrite consent timestamps', async () => {
    const id = await mk('consent-lock@test.invalid', { ai_consent: true, age_18: true });
    const before = (await db.query(`select ai_consent_at, age_confirmed_at from profiles where user_id=$1`, [id])).rows[0];
    await as(id, `update profiles set ai_consent_at = null, age_confirmed_at = null, locale = 'en' where user_id = $1`, [id]);
    const after = (await db.query(`select ai_consent_at, age_confirmed_at, locale from profiles where user_id=$1`, [id])).rows[0];
    assert.equal(String(after.ai_consent_at), String(before.ai_consent_at));
    assert.equal(String(after.age_confirmed_at), String(before.age_confirmed_at));
    assert.equal(after.locale, 'en');
  });
}
