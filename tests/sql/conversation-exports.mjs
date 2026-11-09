// Court export register, access rules, rate limits and public verification. Synthetic data only.
export async function testConversationExports({ db, as, svc, t, assert }) {
  const rejects = (p, re) => assert.rejects(p, re);
  const [E79, E49, P, L, O] = (await db.query(`insert into auth.users(email) values ('exp79@example.invalid'),('exp49@example.invalid'),('part@example.invalid'),('late@example.invalid'),('outsider@example.invalid') returning id`)).rows.map(r => r.id);
  await db.query(`insert into user_plans(user_id,plan) values ($1,'text_attachments'),($2,'text'),($3,'text_attachments'),($4,'text_attachments'),($5,'text_attachments')`, [E79, E49, P, L, O]);
  const cv = (await db.query(`insert into conversations(created_by) values($1) returning id`, [E79])).rows[0].id;
  await db.query(`insert into memberships(conversation_id,user_id,role,joined_at) values($1,$2,'parent',now()-interval '10 days'),($1,$3,'parent',now()-interval '10 days'),($1,$4,'parent',now()-interval '10 days')`, [cv, E79, P, E49]);
  let k = 0;
  const put = async (sender, body, ago, released = true, att = null) => {
    const id = (await db.query(`insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,created_at) values($1,$2,$3,'h',$4,now()-$5::interval) returning id`, [cv, sender, body, 'exp-key-' + (++k), ago])).rows[0].id;
    await db.query(`insert into message_deliveries(message_id,recipient_id,released_at) select $1,m.user_id,case when $3 then now() end from memberships m where m.conversation_id=$2 and m.user_id<>(select sender_id from messages where id=$1) and m.left_at is null`, [id, cv, released]);
    if (att) await db.query(`insert into message_attachments(message_id,mime,name,size,data) values($1,'application/pdf','ugeplan.pdf',4,decode('25504446','hex'))`, [id]);
    return id;
  };
  const m1 = await put(P, 'Syntetisk besked 1', '5 days'), m2 = await put(E79, 'Syntetisk svar', '4 days', true, true);
  const hidden = await put(P, 'Endnu ikke frigivet', '1 hour', false);
  await db.query(`insert into memberships(conversation_id,user_id,role,joined_at) values($1,$2,'reader',now()-interval '3 days')`, [cv, L]);
  const m3 = await put(P, 'Efter L kom med', '2 days');
  const begin = (uid, kind = 'self', email = null, from = null, to = null) => svc(`select * from begin_conversation_export($1,$2,$3,$4,$5,$6)`, [uid, cv, from, to, kind, email]);

  await t('Export: kun 79-plan (server-side), 49 afvises', async () => {
    await rejects(begin(E49), /plan_required/);
    const r = (await begin(E79))[0]; assert.match(r.verify_code, /^[0-9A-F]{20}$/); assert.equal(r.recipient, 'exp79@example.invalid'); assert.deepEqual(r.partners.sort(), ['exp49@example.invalid', 'late@example.invalid', 'part@example.invalid']);
    await svc(`select finish_conversation_export($1,$2,false,null,null,null)`, [r.export_id, E79]);
  });
  await t('Export: uvedkommende og klienter har ingen adgang til register/RPC', async () => {
    await rejects(begin(O), /not_member/);
    await rejects(as(E79, `select * from begin_conversation_export($1,$2,null,null,'self',null)`, [E79, cv]), /permission denied/);
    await rejects(as(E79, `select * from get_export_messages($1,$2,null,null)`, [E79, cv]), /permission denied/);
    await rejects(as(E79, `select * from conversation_exports`), /permission denied/);
    await rejects(as(E79, `select * from verify_conversation_export($1,'x',null)`, ['0'.repeat(64)]), /permission denied/);
    await rejects(as(E79, `select finish_conversation_export(gen_random_uuid(),$1,true,$2,1,1)`, [E79, 'a'.repeat(64)]), /permission denied/);
  });
  await t('Export: anden modtager valideres; self ignorerer klient-adresse', async () => {
    for (const bad of ['nope', 'a@b', 'x@@y.dk', 'a b@c.dk', 'a@b..dk', 'x'.repeat(250) + '@a.dk']) await rejects(begin(E79, 'other', bad), /bad_email/);
    const r = (await begin(E79, 'self', 'attacker@example.invalid'))[0]; assert.equal(r.recipient, 'exp79@example.invalid');
    await svc(`select finish_conversation_export($1,$2,false,null,null,null)`, [r.export_id, E79]);
    await rejects(begin(E79, 'other', 'ok@example.invalid', new Date('2026-02-01'), new Date('2026-01-01')), /bad_period/);
  });
  await t('Export: samme synlighed som appen (join-tid, frigivelse), periode-udsnit, vedhæftning kun hash', async () => {
    const forE = await svc(`select * from get_export_messages($1,$2,null,null)`, [E79, cv]);
    assert.deepEqual(forE.map(r => r.id), [m1, m2, m3]);   // hidden (not released to E79) excluded
    const forP = await svc(`select * from get_export_messages($1,$2,null,null)`, [P, cv]);
    assert.ok(forP.some(r => r.id === hidden), 'sender sees own pending message');
    const forL = await svc(`select * from get_export_messages($1,$2,null,null)`, [L, cv]);
    assert.deepEqual(forL.map(r => r.id), [m3]);
    const att = forE.find(r => r.id === m2); assert.equal(att.att_sha256, (await db.query(`select encode(extensions.digest(decode('25504446','hex'),'sha256'),'hex') h`)).rows[0].h);
    assert.equal(att.att_size, 4); assert.ok(!('data' in att) && !('data_b64' in att));
    const part = await svc(`select * from get_export_messages($1,$2,now()-interval '4 days 1 hour',now()-interval '3 days')`, [E79, cv]);
    assert.deepEqual(part.map(r => r.id), [m2]);
    await rejects(svc(`select * from get_export_messages($1,$2,null,null)`, [O, cv]), /not_member/);
  });
  let sent;
  await t('Export: afslut gemmer SHA-256 af endelig PDF og laver hændelse til alle', async () => {
    sent = (await begin(E79, 'other', 'Advokat@Example.invalid', null, null))[0]; assert.equal(sent.recipient, 'advokat@example.invalid');
    await svc(`select finish_conversation_export($1,$2,true,$3,3,2)`, [sent.export_id, E79, 'ab'.repeat(32)]);
    await rejects(svc(`select finish_conversation_export($1,$2,true,$3,3,2)`, [sent.export_id, E79, 'cd'.repeat(32)]), /not_found/);
    const evP = await as(P, `select * from get_conversation_events($1)`, [cv]); assert.equal(evP.length, 1); assert.equal(evP[0].actor_label, 'exp79@example.invalid'); assert.equal(evP[0].mine, false);
    const evE = await as(E79, `select * from get_conversation_events($1)`, [cv]); assert.equal(evE[0].mine, true);
    await rejects(as(O, `select * from get_conversation_events($1)`, [cv]), /not_member/);
  });
  const ip = 'f'.repeat(64);
  const verify = (code, sha, h = ip) => svc(`select * from verify_conversation_export($1,$2,$3)`, [h, code, sha]);
  await t('Verify: match/mismatch/kode, ingen indhold eller identiteter i svaret', async () => {
    const ok = (await verify(null, 'ab'.repeat(32)))[0]; assert.equal(ok.status, 'match'); assert.equal(ok.message_count, 3); assert.equal(ok.page_count, 2);
    assert.deepEqual(Object.keys(ok).sort(), ['created_at', 'message_count', 'page_count', 'partial', 'period_from', 'period_to', 'status']);
    assert.ok(!JSON.stringify(ok).match(/example\.invalid|Syntetisk|[0-9a-f]{8}-[0-9a-f]{4}/));
    assert.equal((await verify(sent.verify_code.replace(/(.{4})/g, '$1-'), 'AB'.repeat(32)))[0].status, 'match');
    assert.equal((await verify('0'.repeat(20), 'ab'.repeat(32)))[0].status, 'mismatch');
    assert.equal((await verify(null, 'ac'.repeat(32)))[0].status, 'mismatch');
    const c = (await verify(sent.verify_code, null))[0]; assert.equal(c.status, 'code_valid'); assert.equal(c.message_count, 3);
    assert.equal((await verify('1'.repeat(20), null))[0].status, 'mismatch');
    await rejects(verify('', ''), /bad_input/);
  });
  await t('Verify: mislykkede eksporter kan ikke verificeres; IP-grænse 20/10 min', async () => {
    const f = (await svc(`select verify_code from conversation_exports where status='failed' limit 1`))[0].verify_code;
    assert.equal((await verify(f, null, 'e'.repeat(64)))[0].status, 'mismatch');
    const h = 'd'.repeat(64); for (let i = 0; i < 20; i++) await verify(null, 'ac'.repeat(32), h);
    await rejects(verify(null, 'ab'.repeat(32), h), /rate_limited/);
    await rejects(verify(null, 'ab'.repeat(32), 'not-a-hash'), /bad_input/);
  });
  await t('Export: grænser 3/time (mislykkede tæller ikke) og højst 5 til andre pr. døgn', async () => {
    // E79 has 1 sent in the last hour; 2 more allowed
    for (let i = 0; i < 2; i++) { const r = (await begin(E79))[0]; await svc(`select finish_conversation_export($1,$2,true,$3,1,1)`, [r.export_id, E79, String(i).repeat(64)]); }
    await rejects(begin(E79), /rate_limited/);
    await db.query(`update conversation_exports set created_at=created_at-interval '2 hours' where exporter_id=$1`, [E79]);
    for (let i = 0; i < 4; i++) { const r = (await begin(E79, 'other', `x${i}@example.invalid`))[0]; await svc(`select finish_conversation_export($1,$2,true,$3,1,1)`, [r.export_id, E79, String(i + 4).repeat(64)]); if (i === 1) await db.query(`update conversation_exports set created_at=created_at-interval '2 hours' where exporter_id=$1`, [E79]); }
    await rejects(begin(E79, 'other', 'y@example.invalid'), /rate_limited/);
  });
  await t('Export: mailfejl markerer eksporten fejlet, fjerner notits og gør den uverificerbar', async () => {
    const r = (await begin(P))[0]; await svc(`select finish_conversation_export($1,$2,true,$3,1,1)`, [r.export_id, P, '9'.repeat(64)]);
    assert.equal((await verify(null, '9'.repeat(64), 'c'.repeat(64)))[0].status, 'match');
    assert.equal((await svc(`select count(*)::int n from conversation_events where export_id=$1`, [r.export_id]))[0].n, 1);
    await rejects(as(P, `select mark_conversation_export_failed($1,$2)`, [r.export_id, P]), /permission denied/);
    await rejects(svc(`select mark_conversation_export_failed($1,$2)`, [r.export_id, E79]), /not_found/);
    assert.equal((await svc(`select status from conversation_exports where id=$1`, [r.export_id]))[0].status, 'sent');
    await svc(`select mark_conversation_export_failed($1,$2)`, [r.export_id, P]);
    assert.equal((await svc(`select status from conversation_exports where id=$1`, [r.export_id]))[0].status, 'failed');
    assert.equal((await svc(`select count(*)::int n from conversation_events where export_id=$1`, [r.export_id]))[0].n, 0);
    assert.equal((await verify(null, '9'.repeat(64), 'c'.repeat(64)))[0].status, 'mismatch');
  });
}
