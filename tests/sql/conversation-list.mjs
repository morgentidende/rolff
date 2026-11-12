// Conversation list preview (list_my_conversations_v2). Synthetic data only.
export async function testConversationList({ db, as, svc, t, assert }) {
  const rejects = (p, re) => assert.rejects(p, re);
  const [A, B, G, L, O] = (await db.query(`insert into auth.users(email) values ('list-a@example.invalid'),('list-b@example.invalid'),('list-g@example.invalid'),('list-late@example.invalid'),('list-out@example.invalid') returning id`)).rows.map(r => r.id);
  const conv = async (ago, members) => {
    const id = (await db.query(`insert into conversations(created_by,created_at) values($1,now()-$2::interval) returning id`, [members[0], ago])).rows[0].id;
    for (const [u, j] of members.map((u, i) => [u, i])) await db.query(`insert into memberships(conversation_id,user_id,role,joined_at) values($1,$2,'parent',now()-interval '30 days')`, [id, u]);
    return id;
  };
  let k = 0;
  const put = async (cv, sender, body, ago, released = true, att = null) => {
    const id = (await db.query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,created_at) values($1,$2,$3,'h',$4,now()-$5::interval) returning id`, [cv, sender, body, 'list-key-' + (++k), ago])).rows[0].id;
    await db.query(`insert into message_deliveries(message_id,recipient_id,released_at) select $1,m.user_id,case when $3 then now() end from memberships m where m.conversation_id=$2 and m.user_id<>$4 and m.left_at is null`, [id, cv, released, sender]);
    if (att) await db.query(`insert into message_attachments(message_id,mime,name,size,data) values($1,$2,$3,4,decode('25504446','hex'))`, [id, att.mime, att.name]);
    return id;
  };
  const c1 = await conv('20 days', [A, B]);     // older conversation, recent message
  const c2 = await conv('2 days', [A, G]);      // newer conversation, older message
  const c3 = await conv('1 day', [A, B, G]);    // no messages at all
  await put(c1, B, 'Første syntetiske besked', '3 hours');
  await put(c1, A, 'Mit syntetiske svar\nmed linjeskift', '2 hours');
  await put(c2, G, 'Syntetisk hilsen fra G', '30 hours');
  // Held back for A (receive time) – must never be previewed to A.
  await put(c2, G, 'HEMMELIG ventende tekst', '10 minutes', false);
  await db.query(`insert into receive_settings(user_id,timezone,enabled) values ($1,'Europe/Copenhagen',true) on conflict (user_id) do update set enabled=true`, [A]);
  const dow = (await db.query(`select extract(isodow from now() at time zone 'Europe/Copenhagen')::int d`)).rows[0].d;
  await db.query(`delete from receive_windows where user_id=$1`, [A]);
  await db.query(`insert into receive_windows(user_id,weekday,start_minute,end_minute) values ($1,$2,600,601)`, [A, dow === 1 ? 3 : 1]);

  await t('Samtaleliste: sorteret efter seneste synlige besked, tom samtale efter oprettelse', async () => {
    const r = await as(A, `select * from list_my_conversations_v2()`);
    assert.deepEqual(r.map(x => x.id), [c1, c3, c2]);
    assert.equal(r[0].last_body, 'Mit syntetiske svar\nmed linjeskift'); assert.equal(r[0].last_mine, true); assert.equal(r[0].last_sender_name, null);
    assert.equal(r[1].last_at, null); assert.equal(r[1].last_body, null);
    assert.equal(r[0].members, 2); assert.equal(r[0].others[0].user_id, B);
  });
  await t('Samtaleliste: ventende (ikke frigivet) besked vises aldrig som uddrag', async () => {
    const r = (await as(A, `select * from list_my_conversations_v2()`)).find(x => x.id === c2);
    assert.equal(r.last_body, 'Syntetisk hilsen fra G'); assert.equal(r.last_mine, false); assert.ok(r.last_sender_name);
    assert.ok(!JSON.stringify(await as(A, `select * from list_my_conversations_v2()`)).includes('HEMMELIG'));
  });
  await t('Samtaleliste: frigivelse i vindue (Modtag nu) opdaterer uddraget', async () => {
    await as(A, `select receive_now()`);
    const r = (await as(A, `select * from list_my_conversations_v2()`));
    assert.equal(r[0].id, c2); assert.equal(r[0].last_body, 'HEMMELIG ventende tekst');
    await db.query(`update receive_settings set enabled=false where user_id=$1`, [A]);
  });
  await t('Samtaleliste: uddrag afkortes til 120 tegn (kodepunkter)', async () => {
    await put(c3, B, '𐀀'.repeat(130), '1 minute');
    const r = (await as(A, `select * from list_my_conversations_v2()`))[0];
    assert.equal(r.id, c3); assert.equal([...r.last_body].length, 120);
  });
  await t('Samtaleliste: vedhæftning giver MIME og kun billedtekst, ikke filnavn-placeholder', async () => {
    await put(c3, G, 'Vedhæftning: skema.pdf', '30 seconds', true, { mime: 'application/pdf', name: 'skema.pdf' });
    let r = (await as(A, `select * from list_my_conversations_v2()`))[0];
    assert.equal(r.last_att_mime, 'application/pdf'); assert.equal(r.last_body, null);
    await put(c3, B, 'Billede af syntetisk ugeplan', '20 seconds', true, { mime: 'image/png', name: 'plan.png' });
    r = (await as(A, `select * from list_my_conversations_v2()`))[0];
    assert.equal(r.last_att_mime, 'image/png'); assert.equal(r.last_body, 'Billede af syntetisk ugeplan');
  });
  await t('Samtaleliste: besked fra før man blev medlem vises ikke', async () => {
    await db.query(`insert into memberships(conversation_id,user_id,role,joined_at) values($1,$2,'reader',now())`, [c1, L]);
    const r = await as(L, `select * from list_my_conversations_v2()`);
    assert.equal(r.length, 1); assert.equal(r[0].id, c1); assert.equal(r[0].last_body, null); assert.equal(r[0].last_at, null);
  });
  await t('Samtaleliste: efter udmeldelse forsvinder samtalen', async () => {
    await db.query(`update memberships set left_at=now() where conversation_id=$1 and user_id=$2`, [c1, L]);
    assert.equal((await as(L, `select * from list_my_conversations_v2()`)).length, 0);
  });
  await t('Samtaleliste: uvedkommende ser intet; anon og uden login afvises', async () => {
    assert.equal((await as(O, `select * from list_my_conversations_v2()`)).length, 0);
    await rejects(as('', `select * from list_my_conversations_v2()`), /unauthenticated/);
    await rejects(db.transaction(async (tx) => { await tx.exec(`set local role anon;`); return tx.query(`select * from list_my_conversations_v2()`); }), /permission denied/);
  });
  await t('Samtaleliste: retention skjuler gamle beskeder i uddraget', async () => {
    const c4 = await conv('3 years', [O, B]);
    await db.query(`update memberships set joined_at=now()-interval '3 years' where conversation_id=$1`, [c4]);
    await put(c4, B, 'Meget gammel syntetisk besked', '2 years');
    const r = (await as(O, `select * from list_my_conversations_v2()`));
    assert.equal(r.length, 1); assert.equal(r[0].last_body, null);
  });
  await t('Samtaleliste: v1 er uændret (gamle klienter)', async () => {
    const r = await as(A, `select * from list_my_conversations()`);
    assert.deepEqual(Object.keys(r[0]).sort(), ['color', 'id', 'members', 'others', 'pending_invitee', 'role']);
  });
}
