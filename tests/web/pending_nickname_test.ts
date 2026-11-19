// Nickname for a contact that has not accepted yet: wiring + copy (da and en). No network, no real data.
const read = (p: string) => Deno.readTextFile(p);
const has = (src: string, s: string) => { if (!src.includes(s)) throw new Error("missing: " + s); };
const lacks = (src: string, s: string) => { if (src.includes(s)) throw new Error("must not contain: " + s); };

Deno.test("sheet: the 'kan ændres, når ...' line is gone in da and en; pending copy exists in both", async () => {
  const dlg = await read("apps/web/src/ContactAlias.tsx");
  lacks(dlg, "Kaldenavnet kan ændres, når invitationen er accepteret");
  lacks(dlg, "You can change the nickname after the invitation is accepted");
  has(dlg, "Personen har ikke accepteret endnu. Kaldenavnet følger med, når invitationen tages imod, og personen kan aldrig se det.");
  has(dlg, "They have not accepted yet. The nickname carries over once the invitation is accepted, and they can never see it.");
  has(dlg, "Kontaktens kaldenavn"); has(dlg, "Contact nickname");
});

Deno.test("app: pending rows use set_invitation_alias, accepted contacts keep set_contact_alias", async () => {
  const app = await read("apps/web/src/App.tsx");
  has(app, 'supabase.rpc("set_invitation_alias", { p_invitation: id, p_alias: alias })');
  has(app, 'supabase.rpc("set_contact_alias", { p_contact: id, p_alias: alias })');
  has(app, "renameTargets(c)");           // list rows (long press)
  has(app, "renameTargets(conv)");        // chat header
  has(app, "pending_alias: conv.pending_alias");
});

Deno.test("migration: owner-only table, RPC checks, carry-over trigger, list columns, export", async () => {
  const names = [...Deno.readDirSync("supabase/migrations")].map((e) => e.name).sort();
  const mig = names.filter((n) => n.includes("pending_invitation_alias"));
  if (mig.length !== 1) throw new Error("expected one migration");
  // timestamp after the newest server migration at the time (invitation mail log, 20261120100000)
  if (!(mig[0] > "20261120100000")) throw new Error("migration timestamp must follow the server migrations");
  const sql = await read("supabase/migrations/" + mig[0]);
  for (const s of [
    "create table public.invitation_aliases", "enable row level security",
    "using (owner_id = auth.uid()) with check (owner_id = auth.uid())",
    "revoke all on public.invitation_aliases from public, anon, authenticated",
    "grant select on public.invitation_aliases to authenticated",
    "create or replace function public.set_invitation_alias", "public.is_active_member(i.conversation_id, me)",
    "insert into contact_aliases(owner_id, contact_user_id, alias)", "create trigger invitation_alias_settle",
    "pending_invitation_id uuid, pending_alias text", "'private_nickname'",
  ]) has(sql, s);
  // the invitee-facing peek must not be redefined here: it never carries a nickname
  lacks(sql, "function public.peek_invitation");
  lacks(sql, "grant insert");
  lacks(sql, "to anon");
});
