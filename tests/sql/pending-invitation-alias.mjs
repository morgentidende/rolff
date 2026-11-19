// Private nickname for a PENDING invitation: owner-only, carried into contact_aliases on acceptance,
// never visible to the invitee, shown by the conversation list, dropped on revoke. Synthetic users only.
export async function testPendingInvitationAlias({ db, as, svc, t, assert, rejects }) {
  const mk = async (...emails) => (await db.query(`insert into auth.users(email) values ${emails.map((_, i) => `($${i + 1})`).join(',')} returning id`, emails)).rows.map(r => r.id);
  const [P, Q, R, S] = await mk('pa-p@test.invalid', 'pa-q@test.invalid', 'pa-r@test.invalid', 'pa-s@test.invalid');
  let inv, conv, token;
  await t('pending alias: no nickname yet -> list shows the invitation id and no alias', async () => {
    const r = (await as(P, `select * from create_email_invitation('pa-q@test.invalid')`))[0];
    inv = r.invitation_id; conv = r.conversation_id; token = r.token;
    for (const fn of ['list_my_conversations', 'list_my_conversations_v2']) {
      const row = (await as(P, `select * from ${fn}() where id = $1`, [conv]))[0];
      assert.equal(row.pending_invitation_id, inv, fn); assert.equal(row.pending_alias, null, fn); assert.equal(row.pending_invitee, 'pa-q@test.invalid', fn);
    }
  });
  await t('pending alias: set, edit and clear (blank) before acceptance', async () => {
    await as(P, `select set_invitation_alias($1, '  Far  ')`, [inv]);
    assert.equal((await as(P, `select pending_alias a from list_my_conversations() where id=$1`, [conv]))[0].a, 'Far', 'trimmed');
    await as(P, `select set_invitation_alias($1, 'Far (arbejde)')`, [inv]);
    assert.equal((await as(P, `select pending_alias a from list_my_conversations_v2() where id=$1`, [conv]))[0].a, 'Far (arbejde)');
    await as(P, `select set_invitation_alias($1, '   ')`, [inv]);
    assert.equal((await as(P, `select pending_alias a from list_my_conversations() where id=$1`, [conv]))[0].a, null, 'blank clears');
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where invitation_id=$1`, [inv])).rows[0].n, 0);
    await as(P, `select set_invitation_alias($1, 'Far')`, [inv]);
  });
  await t('pending alias: validation (40 chars, no line breaks)', async () => {
    await rejects(as(P, `select set_invitation_alias($1, $2)`, [inv, 'x'.repeat(41)]), /bad_alias|check/);
    await rejects(as(P, `select set_invitation_alias($1, E'a\\nb')`, [inv]), /bad_alias/);
    await as(P, `select set_invitation_alias($1, $2)`, [inv, 'y'.repeat(40)]);
    await as(P, `select set_invitation_alias($1, 'Far')`, [inv]);
  });
  await t('pending alias: private - nobody else (not the invitee, not strangers) can read or write it', async () => {
    for (const u of [Q, R]) {
      assert.equal((await as(u, `select count(*)::int n from invitation_aliases`))[0].n, 0, 'RLS hides it');
      await rejects(as(u, `select set_invitation_alias($1, 'Hacket')`, [inv]), /not_found/);
      await rejects(as(u, `insert into invitation_aliases(invitation_id, owner_id, alias) values ($1, $2, 'x')`, [inv, u]), /permission denied/);
      await rejects(as(u, `update invitation_aliases set alias='x'`), /permission denied/);
      await rejects(as(u, `delete from invitation_aliases`), /permission denied/);
      const rows = await as(u, `select * from list_my_conversations()`);
      assert.ok(!rows.some(x => x.id === conv && x.pending_alias), 'not in anybody else\'s list');
    }
    assert.equal((await as(P, `select count(*)::int n from invitation_aliases`))[0].n, 1, 'owner sees own row');
    await rejects(as(P, `insert into invitation_aliases(invitation_id, owner_id, alias) values ($1, $2, 'x')`, [inv, P]), /permission denied/);
    await rejects(as(P, `update invitation_aliases set alias='x'`), /permission denied/);
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where owner_id=$1`, [P])).rows[0].n, 1);
  });
  await t('pending alias: the invitee-facing peek exposes no nickname', async () => {
    const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='invitation_aliases'`)).rows.map(r => r.column_name);
    assert.ok(cols.includes('alias'));
    const peek = (await as(Q, `select * from peek_invitation($1)`, [token]))[0];
    assert.deepEqual(Object.keys(peek).sort(), ['expires_at', 'invitee_email', 'inviter_email']);
    assert.ok(!JSON.stringify(peek).includes('Far'));
    assert.equal((await as(Q, `select * from list_pending_invitations($1)`, [conv])).length, 0, 'a non-member sees no pending invitations');
    assert.equal((await as(Q, `select * from list_my_conversations()`)).length, 0, 'invitee has no row yet');
  });
  await t('pending alias: anonymous callers cannot use it', async () => {
    await rejects(db.transaction(async (tx) => { await tx.exec(`set local role anon`); await tx.query(`select set_invitation_alias($1,'x')`, [inv]); }), /permission denied/);
  });
  await t('pending alias: acceptance carries it to contact_aliases; the pending row is consumed', async () => {
    assert.equal((await as(Q, `select accept_invitation($1) c`, [token]))[0].c, conv);
    const a = (await as(P, `select alias from contact_aliases where contact_user_id=$1`, [Q]));
    assert.deepEqual(a.map(x => x.alias), ['Far']);
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where invitation_id=$1`, [inv])).rows[0].n, 0, 'consumed');
    const row = (await as(P, `select others, pending_alias, pending_invitation_id from list_my_conversations() where id=$1`, [conv]))[0];
    assert.equal(row.others[0].alias, 'Far', 'list shows the contact nickname');
    assert.equal(row.pending_invitation_id, null); assert.equal(row.pending_alias, null);
    assert.equal((await db.query(`select _label_for($1,$2) l`, [P, Q])).rows[0].l, 'Far', 'same label that messages/push use');
    // the invitee never gets a nickname for the inviter, and sees nothing of it
    assert.equal((await as(Q, `select count(*)::int n from contact_aliases`))[0].n, 0);
    assert.equal((await as(Q, `select others from list_my_conversations() where id=$1`, [conv]))[0].others[0].alias, null);
    // and the ordinary contact nickname RPC keeps working afterwards
    await as(P, `select set_contact_alias($1, 'Papa')`, [Q]);
    assert.equal((await as(P, `select others from list_my_conversations() where id=$1`, [conv]))[0].others[0].alias, 'Papa');
  });
  await t('pending alias: an accepted invitation can no longer take a pending nickname', async () => rejects(as(P, `select set_invitation_alias($1,'Sent')`, [inv]), /not_found/));
  await t('pending alias: acceptance replaces an older nickname for the same person; no nickname leaves it alone', async () => {
    const a = (await as(P, `select * from create_email_invitation('pa-r@test.invalid')`))[0];
    await as(P, `select set_invitation_alias($1,'Ny')`, [a.invitation_id]);
    await db.query(`insert into contact_aliases(owner_id, contact_user_id, alias) values ($1,$2,'Gammel')`, [P, R]);
    await as(R, `select accept_invitation($1)`, [a.token]);
    assert.equal((await db.query(`select alias from contact_aliases where owner_id=$1 and contact_user_id=$2`, [P, R])).rows[0].alias, 'Ny');
    const b = (await as(P, `select * from create_email_invitation('pa-s@test.invalid')`))[0];
    await db.query(`insert into contact_aliases(owner_id, contact_user_id, alias) values ($1,$2,'Behold')`, [P, S]);
    await as(S, `select accept_invitation($1)`, [b.token]);
    assert.equal((await db.query(`select alias from contact_aliases where owner_id=$1 and contact_user_id=$2`, [P, S])).rows[0].alias, 'Behold');
  });
  await t('pending alias: revoked invitation forgets the nickname; expired-but-renewable still shows it', async () => {
    const [T] = await mk('pa-t@test.invalid');
    const a = (await as(P, `select * from create_email_invitation('pa-t@test.invalid')`))[0];
    await as(P, `select set_invitation_alias($1,'Tante')`, [a.invitation_id]);
    await db.query(`update invitations set expires_at = now() - interval '2 days' where id=$1`, [a.invitation_id]);
    const row = (await as(P, `select * from list_my_conversations() where id=$1`, [a.conversation_id]))[0];
    assert.equal(row.pending_invitee, null, 'expired: no live invitee e-mail (existing behaviour)');
    assert.equal(row.pending_alias, 'Tante', 'the nickname is still there so the row is not anonymous');
    await as(P, `select set_invitation_alias($1,'Tante Anne')`, [a.invitation_id]);
    await db.query(`update invitations set revoked_at = now() where id=$1`, [a.invitation_id]);
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where invitation_id=$1`, [a.invitation_id])).rows[0].n, 0);
    await rejects(as(P, `select set_invitation_alias($1,'x')`, [a.invitation_id]), /not_found/);
    // long expired (> 30 days) invitations can no longer be nicknamed
    const c = (await as(P, `select * from create_email_invitation('pa-u@test.invalid')`))[0];
    await db.query(`update invitations set expires_at = now() - interval '31 days' where id=$1`, [c.invitation_id]);
    await rejects(as(P, `select set_invitation_alias($1,'x')`, [c.invitation_id]), /not_found/);
  });
  await t('pending alias: unknown invitation id and unauthenticated call fail generically', async () => {
    await rejects(as(P, `select set_invitation_alias(gen_random_uuid(),'x')`), /not_found/);
    await rejects(db.transaction(async (tx) => { await tx.exec(`set local role authenticated; select set_config('request.jwt.sub','',true);`); await tx.query(`select set_invitation_alias(gen_random_uuid(),'x')`); }), /unauthenticated/);
  });
  await t('pending alias: deleting the owner or the invitation removes the nickname (no orphans)', async () => {
    const [U] = await mk('pa-owner@test.invalid');
    const a = (await as(U, `select * from create_email_invitation('pa-v@test.invalid')`))[0];
    await as(U, `select set_invitation_alias($1,'Bort')`, [a.invitation_id]);
    await db.query(`delete from auth.users where id=$1`, [U]);
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where owner_id=$1`, [U])).rows[0].n, 0);
  });
  await t('pending alias: export lists the owner\'s own pending nickname only', async () => {
    const [W, X] = await mk('pa-w@test.invalid', 'pa-x@test.invalid');
    const a = (await as(W, `select * from create_email_invitation('pa-y@test.invalid')`))[0];
    await as(W, `select set_invitation_alias($1,'Eksport')`, [a.invitation_id]);
    const mine = (await svc(`select export_user_data($1) d`, [W]))[0].d;
    assert.equal(mine.invitations_created[0].private_nickname, 'Eksport');
    const other = (await svc(`select export_user_data($1) d`, [X]))[0].d;
    assert.ok(!JSON.stringify(other).includes('Eksport'));
  });
  await t('pending alias: a second member keeps their OWN nickname for the same invitation (each is private)', async () => {
    const [M1, M2, I] = await mk('pa-m1@test.invalid', 'pa-m2@test.invalid', 'pa-i@test.invalid');
    const a = (await as(M1, `select * from create_email_invitation('pa-i@test.invalid')`))[0];
    await db.query(`insert into memberships(conversation_id,user_id,role) values ($1,$2,'parent')`, [a.conversation_id, M2]);
    await db.query(`update invitations set member_version = (select member_version from conversations where id=$1) where id=$2`, [a.conversation_id, a.invitation_id]);
    await as(M1, `select set_invitation_alias($1,'Bonus')`, [a.invitation_id]);
    await as(M2, `select set_invitation_alias($1,'Svigerfar')`, [a.invitation_id]);
    assert.equal((await as(M1, `select alias from invitation_aliases`))[0].alias, 'Bonus');
    assert.equal((await as(M2, `select alias from invitation_aliases`))[0].alias, 'Svigerfar');
    assert.equal((await as(I, `select count(*)::int n from invitation_aliases`))[0].n, 0, 'the invitee sees none');
    assert.equal((await as(M2, `select count(*)::int n from invitation_aliases`))[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n from invitation_aliases where invitation_id=$1`, [a.invitation_id])).rows[0].n, 2);
  });
}
