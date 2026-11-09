// Migration 20261109170000_remove_public_name: clears existing self-chosen names and keeps private
// aliases. Runs on its own PGlite: all earlier migrations, synthetic data, then the new migration.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
const MIG = '20261109170000_remove_public_name.sql';
export async function testRemovePublicName({ t, assert }) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key default gen_random_uuid(), email varchar(255), raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
    grant usage on schema auth, public, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  const dir = '../../supabase/migrations/';
  for (const f of fs.readdirSync(dir).sort()) if (f < MIG) await db.exec(fs.readFileSync(dir + f, 'utf8'));
  const as = (uid, sql, p = []) => db.transaction(async (tx) => { await tx.exec(`set local role authenticated; select set_config('request.jwt.sub', '${uid}', true);`); return (await tx.query(sql, p)).rows; });
  const [A, B] = (await db.query(`insert into auth.users(email) values ('rpn-a@example.invalid'),('rpn-b@example.invalid') returning id`)).rows.map(r => r.id);
  const conv = (await db.query(`insert into conversations(created_by) values($1) returning id`, [A])).rows[0].id;
  for (const u of [A, B]) await db.query(`insert into memberships(conversation_id,user_id,role) values($1,$2,'parent')`, [conv, u]);
  await as(A, `select set_my_public_name('Provokerende navn')`);
  await as(B, `select set_contact_alias($1,'Bs private navn for A')`, [A]);
  const label = async () => (await as(B, `select others from list_my_conversations() where id=$1`, [conv]))[0].others.find(o => o.user_id === A);
  await t('Fjern visningsnavn (før migration): selvvalgt navn vises for andre', async () => assert.equal((await label()).email, 'Provokerende navn'));
  await db.exec(fs.readFileSync(dir + MIG, 'utf8'));
  await t('Fjern visningsnavn: migration rydder eksisterende navne, andre ser e-mail', async () => {
    assert.equal((await db.query(`select count(*)::int n from profiles where public_name is not null`)).rows[0].n, 0);
    const o = await label(); assert.equal(o.email, 'rpn-a@example.invalid'); assert.ok(!JSON.stringify(o).includes('Provokerende'));
  });
  await t('Fjern visningsnavn: private kaldenavne er bevaret', async () => {
    assert.equal((await db.query(`select alias from contact_aliases where owner_id=$1 and contact_user_id=$2`, [B, A])).rows[0].alias, 'Bs private navn for A');
    assert.equal((await label()).alias, 'Bs private navn for A');
  });
  await t('Fjern visningsnavn: migration kan køres igen (idempotent)', async () => { await db.exec(fs.readFileSync(dir + MIG, 'utf8')); });
  await db.close();
}
