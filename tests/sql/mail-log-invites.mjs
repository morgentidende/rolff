// Invitation mail reliability: mail_log is server-only, links can be re-minted (rate-limited),
// failed mails are flagged, expired invitations are listed as expired and can be removed.
export async function testMailLogInvites({ db, as, svc, t, assert, rejects }) {
  const [P, Q, R] = (await db.query(`insert into auth.users(email) values ('ml-p@test.invalid'),('ml-q@test.invalid'),('ml-r@test.invalid') returning id`)).rows.map(r => r.id);
  await t('mail_log: klienter kan hverken læse eller skrive', async () => {
    await rejects(as(P, `select * from mail_log`), /permission denied/);
    await rejects(as(P, `insert into mail_log(kind,status,provider) values ('invite','sent','smtp')`), /permission denied/);
    await svc(`insert into mail_log(kind,status,provider,response_code,reason,recipient_hash) values ('invite','failed','smtp',550,'rcpt:550','ab12')`);
    assert.equal((await svc(`select count(*)::int n from mail_log`))[0].n >= 1, true);
    await rejects(svc(`insert into mail_log(kind,status,provider) values ('invite','maybe','smtp')`), /check/);
  });
  await t('mail_log har ingen indholdskolonner', async () => {
    const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='mail_log'`)).rows.map(r => r.column_name).sort();
    assert.deepEqual(cols, ['created_at','id','kind','provider','reason','recipient_hash','response_code','status']);
  });
  let inv, conv, firstToken;
  await t('Fejlet mail: invitation forbliver ventende og markeres', async () => {
    const r = (await as(P, `select * from create_email_invitation('ml-q@test.invalid')`))[0];
    inv = r.invitation_id; conv = r.conversation_id; firstToken = r.token;
    await svc(`select set_invitation_mail_status($1,false)`, [inv]);
    const p = (await as(P, `select * from list_pending_invitations($1)`, [conv]))[0];
    assert.equal(p.id, inv); assert.equal(p.mail_failed, true); assert.equal(p.expired, false); assert.equal(p.can_manage, true); assert.equal(p.consents >= p.required, true);
  });
  await t('Klient kan ikke sætte mailstatus', async () => rejects(as(P, `select set_invitation_mail_status($1,true)`, [inv]), /permission denied/));
  let fresh;
  await t('Nyt link: gammelt link dør, nyt virker', async () => {
    fresh = (await as(P, `select * from reissue_invitation_link($1)`, [inv]))[0];
    assert.match(fresh.token, /^[0-9a-f]{48}$/); assert.notEqual(fresh.token, firstToken); assert.equal(fresh.invitee_email, 'ml-q@test.invalid'); assert.equal(fresh.role, 'parent');
    assert.equal((await as(Q, `select count(*)::int n from peek_invitation($1)`, [firstToken]))[0].n, 0);
    assert.equal((await as(Q, `select count(*)::int n from peek_invitation($1)`, [fresh.token]))[0].n, 1);
  });
  await t('Nyt link er rate-limited (30 s)', async () => rejects(as(P, `select * from reissue_invitation_link($1)`, [inv]), /rate_limited/));
  await t('Højst 10 nye links pr. døgn', async () => {
    for (let k = 0; k < 9; k++) {
      await db.query(`update invitations set reissued_at = now() - interval '1 minute' where id = $1`, [inv]);
      await as(P, `select * from reissue_invitation_link($1)`, [inv]);
    }
    await db.query(`update invitations set reissued_at = now() - interval '1 minute' where id = $1`, [inv]);
    await rejects(as(P, `select * from reissue_invitation_link($1)`, [inv]), /rate_limited/);
    await db.query(`update invitations set reissued_at = now() - interval '1 minute', reissue_window_start = now() - interval '25 hours' where id = $1`, [inv]);
    fresh = (await as(P, `select * from reissue_invitation_link($1)`, [inv]))[0]; assert.ok(fresh.token);
  });
  await t('Uvedkommende kan ikke lave nyt link', async () => {
    await rejects(as(R, `select * from reissue_invitation_link($1)`, [inv]), /not_found/);
    await rejects(as(Q, `select * from reissue_invitation_link($1)`, [inv]), /not_found/);
  });
  await t('Udløbet invitation vises som udløbet og kan fornys', async () => {
    await db.query(`update invitations set expires_at = now() - interval '1 day', reissued_at = now() - interval '1 minute' where id = $1`, [inv]);
    const p = (await as(P, `select * from list_pending_invitations($1)`, [conv]))[0];
    assert.equal(p.expired, true);
    const r = (await as(P, `select * from reissue_invitation_link($1)`, [inv]))[0];
    assert.ok(new Date(r.expires_at) > new Date());
    assert.equal((await as(P, `select expired from list_pending_invitations($1)`, [conv]))[0].expired, false);
  });
  await t('Meget gamle udløbne skjules; udløbne kan fjernes', async () => {
    await db.query(`update invitations set expires_at = now() - interval '31 days' where id = $1`, [inv]);
    assert.equal((await as(P, `select count(*)::int n from list_pending_invitations($1)`, [conv]))[0].n, 0);
    await db.query(`update invitations set expires_at = now() - interval '2 days' where id = $1`, [inv]);
    await as(P, `select revoke_invitation($1)`, [inv]);
    assert.equal((await as(P, `select count(*)::int n from list_pending_invitations($1)`, [conv]))[0].n, 0);
    await rejects(as(P, `select * from reissue_invitation_link($1)`, [inv]), /not_found/);
  });
  await t('Vellykket mail rydder fejlmarkering', async () => {
    const r = (await as(P, `select * from create_email_invitation('ml-r@test.invalid')`))[0];
    await svc(`select set_invitation_mail_status($1,false)`, [r.invitation_id]);
    await svc(`select set_invitation_mail_status($1,true)`, [r.invitation_id]);
    assert.equal((await as(P, `select mail_failed from list_pending_invitations($1)`, [r.conversation_id]))[0].mail_failed, false);
  });
}
