// Migration 20261113080000_sticky_moderation_blocks: hash-only memory of blocked texts per sender+conversation.
export async function testStickyBlocks({ db, as, svc, t, assert, rejects }) {
  const [U, V] = (await db.query(`insert into auth.users(email) values ('sb-a@example.invalid'),('sb-b@example.invalid') returning id`)).rows.map(r => r.id);
  const conv = (await as(U, `select create_conversation('Sticky') c`))[0].c;
  const conv2 = (await as(U, `select create_conversation('Sticky2') c`))[0].c;
  const H = 'a'.repeat(64), H2 = 'b'.repeat(64);
  await t('Sticky: ukendt tekst giver null', async () => {
    assert.equal((await svc(`select recent_moderation_block($1,$2,$3) r`, [U, conv, H]))[0].r, null);
  });
  await t('Sticky: husket blokering findes igen for samme afsender+samtale', async () => {
    await svc(`select remember_moderation_block($1,$2,$3,'personal_attack')`, [U, conv, H]);
    assert.equal((await svc(`select recent_moderation_block($1,$2,$3) r`, [U, conv, H]))[0].r, 'personal_attack');
    await svc(`select remember_moderation_block($1,$2,$3,'personal_attack')`, [U, conv, H]);
    assert.equal((await db.query(`select count(*)::int n from moderation_block_memory where sender_id=$1`, [U])).rows[0].n, 1);
  });
  await t('Sticky: gælder ikke anden afsender, anden samtale eller anden tekst', async () => {
    assert.equal((await svc(`select recent_moderation_block($1,$2,$3) r`, [V, conv, H]))[0].r, null);
    assert.equal((await svc(`select recent_moderation_block($1,$2,$3) r`, [U, conv2, H]))[0].r, null);
    assert.equal((await svc(`select recent_moderation_block($1,$2,$3) r`, [U, conv, H2]))[0].r, null);
  });
  await t('Sticky: udløbet blokering tæller ikke og ryddes op', async () => {
    await db.query(`update moderation_block_memory set expires_at = now() - interval '1 minute' where sender_id=$1`, [U]);
    assert.equal((await svc(`select recent_moderation_block($1,$2,$3) r`, [U, conv, H]))[0].r, null);
    await svc(`select remember_moderation_block($1,$2,$3,'threat')`, [U, conv, H2]);
    assert.equal((await db.query(`select count(*)::int n from moderation_block_memory where sender_id=$1 and text_hash=$2`, [U, H])).rows[0].n, 0);
  });
  await t('Sticky: afviser ugyldig hash og allow/clarify-koder', async () => {
    await rejects(svc(`select remember_moderation_block($1,$2,'kort','personal_attack')`, [U, conv]), /invalid_block/);
    await rejects(svc(`select remember_moderation_block($1,$2,$3,'none')`, [U, conv, H]), /invalid_block/);
    await rejects(svc(`select remember_moderation_block($1,$2,$3,'unclear_meaning')`, [U, conv, H]), /invalid_block/);
  });
  await t('Sticky: brugere kan hverken læse tabellen eller kalde funktionerne', async () => {
    await rejects(as(U, `select * from moderation_block_memory`), /permission denied/);
    await rejects(as(U, `select recent_moderation_block($1,$2,$3)`, [U, conv, H]), /permission denied/);
    await rejects(as(U, `select remember_moderation_block($1,$2,$3,'threat')`, [U, conv, H]), /permission denied/);
  });
}
