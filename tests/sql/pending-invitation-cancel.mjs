// "Annullér invitation": a conversation that only waits for the invitee is revoked and leaves the list; nothing is deleted.
export async function testPendingInvitationCancel({ db, as, svc, t, assert, rejects }) {
  const mk = async (...emails) => (await db.query(`insert into auth.users(email) values ${emails.map((_, i) => `($${i + 1})`).join(',')} returning id`, emails)).rows.map(r => r.id);
  const [P, Q, R] = await mk('pc-p@test.invalid', 'pc-q@test.invalid', 'pc-r@test.invalid');
  await t('cancel pending: revokes the invitation, drops the nickname, hides the row, keeps the data', async () => {
    const a = (await as(P, `select * from create_email_invitation('pc-q@test.invalid')`))[0];
    await as(P, `select set_invitation_alias($1,'Far')`, [a.invitation_id]);
    assert.equal((await as(P, `select count(*)::int n from list_my_conversations() where id=$1`, [a.conversation_id]))[0].n, 1);
    await as(P, `select cancel_pending_invitation($1)`, [a.invitation_id]);
    const inv = (await db.query(`select revoked_at, declined_by from invitations where id=$1`, [a.invitation_id])).rows[0];
    assert.ok(inv.revoked_at); assert.equal(inv.declined_by, P);
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where invitation_id=$1`, [a.invitation_id])).rows[0].n, 0);
    for (const fn of ['list_my_conversations', 'list_my_conversations_v2']) assert.equal((await as(P, `select count(*)::int n from ${fn}() where id=$1`, [a.conversation_id]))[0].n, 0, fn);
    assert.equal((await db.query(`select count(*)::int n from conversations where id=$1`, [a.conversation_id])).rows[0].n, 1, 'conversation row kept');
    await rejects(as(Q, `select accept_invitation($1)`, [a.token]), /invalid_invitation/);
  });
  await t('cancel pending: only an active member of that conversation; unknown ids are refused', async () => {
    const a = (await as(P, `select * from create_email_invitation('pc-q@test.invalid')`))[0];
    await rejects(as(R, `select cancel_pending_invitation($1)`, [a.invitation_id]), /not_found/);
    await rejects(as(P, `select cancel_pending_invitation('00000000-0000-4000-8000-000000000000')`), /not_found/);
    await as(P, `select cancel_pending_invitation($1)`, [a.invitation_id]);
  });
  await t('cancel pending: a conversation with another active member is refused', async () => {
    const a = (await as(P, `select * from create_email_invitation('pc-q@test.invalid')`))[0];
    await as(Q, `select accept_invitation($1)`, [a.token]);
    await rejects(as(P, `select cancel_pending_invitation($1)`, [a.invitation_id]), /not_found|not_pending_only/);
    assert.equal((await as(P, `select count(*)::int n from list_my_conversations() where id=$1`, [a.conversation_id]))[0].n, 1, 'still listed');
  });
  await t('cancel pending: an already accepted invitation cannot be cancelled this way', async () => {
    const a = (await as(P, `select * from create_email_invitation('pc-r@test.invalid')`))[0];
    await as(R, `select accept_invitation($1)`, [a.token]);
    await rejects(as(P, `select cancel_pending_invitation($1)`, [a.invitation_id]), /not_found/);
  });
  await t('cancel pending: not callable by anon', async () => {
    await rejects(db.transaction(async tx => { await tx.exec(`set local role anon`); await tx.query(`select cancel_pending_invitation('00000000-0000-4000-8000-000000000000')`); }), /permission denied/);
  });
}
