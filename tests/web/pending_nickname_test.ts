// Nickname for a contact that has not accepted yet: wiring + copy (da and en). No network, no real data.
const read = (p: string) => Deno.readTextFile(p);
const has = (src: string, s: string) => { if (!src.includes(s)) throw new Error("missing: " + s); };
const lacks = (src: string, s: string) => { if (src.includes(s)) throw new Error("must not contain: " + s); };

Deno.test("sheet: no explanatory paragraphs in da and en (they live in the FAQ); title, field, original name, buttons stay", async () => {
  const dlg = await read("apps/web/src/ContactAlias.tsx");
  for (const s of ["Kaldenavnet kan ændres, når invitationen er accepteret", "You can change the nickname after the invitation is accepted",
    "Personen har ikke accepteret endnu", "They have not accepted yet", "Kun du kan se dette navn", "Only you can see this name", "contact-alias-pending"]) lacks(dlg, s);
  for (const s of ["Kontaktens kaldenavn", "Contact nickname", "Oprindeligt navn: ", "Original name: ", "Annuller", "Cancel", "contact-alias-input"]) has(dlg, s);
});

Deno.test("FAQ: one concise nickname entry (da + en) that covers pending invitations; the sheet explanation moved there", async () => {
  const app = await read("apps/web/src/App.tsx");
  const faq = app.slice(app.indexOf("function Faq"), app.indexOf("export const evidenceNote"));
  has(faq, '["Hvad er et kaldenavn?"'); has(faq, '["What is a nickname?"');
  for (const s of ["Kun du kan se det", "kan aldrig se det", "venter på accept", "annullere invitationen"]) has(faq, s);
  for (const s of ["Only you can see it", "can never see it", "waiting for acceptance", "cancel the invitation"]) has(faq, s);
});

Deno.test("pending rows: tap and long press open a two-choice menu; no route opens the empty conversation", async () => {
  const app = await read("apps/web/src/App.tsx"), menu = await read("apps/web/src/PendingInviteMenu.tsx"), cd = await read("apps/web/src/convDisplay.ts");
  has(menu, "Ændr kaldenavn"); has(menu, "Change nickname"); has(menu, "Annullér invitation"); has(menu, "Cancel invitation");
  has(app, "open={() => (isPendingOnly(c) ? setPendingMenu(c) : open(c))}");
  has(app, "if (isPendingOnly(c)) setPendingMenu(c); else rename(renameTargets(c))");
  has(app, 'supabase.rpc("cancel_pending_invitation", { inv: c.pending_invitation_id })');
  has(app, "const conv = isPendingOnly(rawConv) ? null : rawConv;");   // list, #open=, push tap and accept link all go through this
  has(cd, "export const isPendingOnly");
});

Deno.test("migration cancel_pending_invitation: sole member only, revokes like decline, member leaves, nothing deleted, authenticated only", async () => {
  const names = [...Deno.readDirSync("supabase/migrations")].map((e) => e.name).sort();
  const mig = names.filter((n) => n.includes("cancel_pending_invitation"));
  if (mig.length !== 1) throw new Error("expected one migration");
  if (!(mig[0] > "20261120130000")) throw new Error("must follow the newest migration");
  const sql = await read("supabase/migrations/" + mig[0]);
  for (const s of ["create or replace function public.cancel_pending_invitation(inv uuid)", "security definer", "public.is_active_member(i.conversation_id, me)",
    "'not_pending_only'", "set revoked_at = now(), declined_at = now(), declined_by = me", "update memberships set left_at = now()",
    "revoke execute on function public.cancel_pending_invitation(uuid) from public, anon, authenticated",
    "grant execute on function public.cancel_pending_invitation(uuid) to authenticated"]) has(sql, s);
  lacks(sql, "delete from");
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
