// "X har skiftet e-mail til Y": system notice on confirmed e-mail change. Synthetic data only.
export async function testEmailChangeNotice({ db, as, svc, t, assert }) {
  const [A, B, C, Z] = (await db.query(`insert into auth.users(email) values ('ec-a-old@example.invalid'),('ec-b@example.invalid'),('ec-c@example.invalid'),('ec-z@example.invalid') returning id`)).rows.map(r => r.id);
  const mk = async (members) => { const id = (await db.query(`insert into conversations(created_by) values($1) returning id`, [members[0]])).rows[0].id;
    for (const u of members) await db.query(`insert into memberships(conversation_id,user_id,role,joined_at) values($1,$2,'parent',now()-interval '1 day')`, [id, u]); return id; };
  const c1 = await mk([A, B]), c2 = await mk([A, C]), cz = await mk([B, Z]);
  const left = await mk([A, Z]); await db.query(`update memberships set left_at=now() where conversation_id=$1 and user_id=$2`, [left, A]);
  await as(B, `select set_contact_alias($1,'Bs navn for A')`, [A]);
  const msgsBefore = (await db.query(`select count(*)::int n from messages`)).rows[0].n;
  await db.query(`update auth.users set email='ec-a-new@example.invalid' where id=$1`, [A]);
  const ev = async (uid, conv) => (await as(uid, `select * from get_conversation_events($1)`, [conv])).filter(e => e.kind === 'email_changed');

  await t('E-mailskift: notits i hver aktiv samtale, ikke i forladte eller fremmede', async () => {
    const n = (await db.query(`select conversation_id from conversation_events where kind='email_changed' and actor_id=$1`, [A])).rows.map(r => r.conversation_id).sort();
    assert.deepEqual(n, [c1, c2].sort());
    assert.equal((await ev(B, cz)).length, 0);
  });
  await t('E-mailskift: modtager ser eget private kaldenavn, ellers den gamle e-mail; ny e-mail vises', async () => {
    const b = await ev(B, c1); assert.equal(b.length, 1); assert.equal(b[0].actor_label, 'Bs navn for A'); assert.equal(b[0].new_label, 'ec-a-new@example.invalid'); assert.equal(b[0].mine, false);
    const c = await ev(C, c2); assert.equal(c[0].actor_label, 'ec-a-old@example.invalid'); assert.equal(c[0].new_label, 'ec-a-new@example.invalid');
    const a = await ev(A, c1); assert.equal(a[0].mine, true);
  });
  await t('E-mailskift: er ikke en besked (tæller ikke i grænser/modtagetider), kaldenavn bevaret', async () => {
    assert.equal((await db.query(`select count(*)::int n from messages`)).rows[0].n, msgsBefore);
    assert.equal((await db.query(`select alias from contact_aliases where owner_id=$1 and contact_user_id=$2`, [B, A])).rows[0].alias, 'Bs navn for A');
  });
  await t('E-mailskift: samme e-mail (anden versalisering) eller andre kolonner giver ingen notits', async () => {
    await db.query(`update auth.users set email='EC-A-NEW@example.invalid' where id=$1`, [A]);
    await db.query(`update auth.users set last_sign_in_at=now() where id=$1`, [A]);
    assert.equal((await db.query(`select count(*)::int n from conversation_events where kind='email_changed' and actor_id=$1`, [A])).rows[0].n, 2);
  });
  await t('E-mailskift: brugere kan ikke selv indsætte notitser', async () => {
    await assert.rejects(as(B, `insert into conversation_events(conversation_id,actor_id,kind,old_email,new_email) values($1,$2,'email_changed','x','y')`, [c1, B]), /permission|denied/);
    await assert.rejects(as(B, `select _on_auth_email_changed()`), /permission|denied|trigger/);
  });
}
