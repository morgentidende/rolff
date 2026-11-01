-- Invitations carry only the invitee e-mail (no recipient name). Counterparts are shown by e-mail by default;
-- each user may set a PRIVATE alias for a contact, visible only to the owner.
update public.invitations set invitee_name = null where invitee_name is not null;
update public.conversations c set title = null where exists (select 1 from invitations i where i.conversation_id = c.id and i.invitee_email is not null);
alter table public.invitations drop column invitee_name;

create table public.contact_aliases (
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_user_id uuid not null references auth.users(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 40 and alias !~ '[\r\n]'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, contact_user_id),
  check (owner_id <> contact_user_id)
);
alter table public.contact_aliases enable row level security;
create policy aliases_owner_all on public.contact_aliases for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.contact_aliases from anon, authenticated;
grant select, delete on public.contact_aliases to authenticated;
grant all on public.contact_aliases to service_role;

-- Set or clear (empty/blank) an alias. Only for users you share (or shared) a conversation with.
create or replace function public.set_contact_alias(p_contact uuid, p_alias text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a text := nullif(trim(coalesce(p_alias,'')), '');
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_contact = me or not exists (select 1 from memberships m1 join memberships m2 on m1.conversation_id = m2.conversation_id
      where m1.user_id = me and m2.user_id = p_contact) then raise exception 'not_found' using errcode='P0002'; end if;
  if a is null then delete from contact_aliases where owner_id = me and contact_user_id = p_contact; return; end if;
  if char_length(a) > 40 or a ~ '[\r\n]' then raise exception 'bad_alias' using errcode='22023'; end if;
  insert into contact_aliases(owner_id, contact_user_id, alias) values (me, p_contact, a)
    on conflict (owner_id, contact_user_id) do update set alias = excluded.alias, updated_at = now();
end $$;

-- Label shown to the CALLER for a user: own alias, else e-mail.
create or replace function public._label_for(viewer uuid, target uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select alias from contact_aliases where owner_id = viewer and contact_user_id = target),
                  (select email from auth.users where id = target), '?')
$$;
revoke execute on function public._label_for(uuid,uuid) from public, anon, authenticated;

drop function public.list_my_conversations();
create function public.list_my_conversations()
returns table(id uuid, title text, role public.member_role, members int, others jsonb)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, m.role, (select count(*)::int from memberships x where x.conversation_id=c.id and x.left_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'email', u.email,
        'alias', (select alias from contact_aliases a where a.owner_id = auth.uid() and a.contact_user_id = o.user_id)) order by o.joined_at)
      from memberships o join auth.users u on u.id = o.user_id
      where o.conversation_id = c.id and o.left_at is null and o.user_id <> auth.uid()), '[]'::jsonb)
  from conversations c join memberships m on m.conversation_id=c.id and m.user_id=auth.uid() and m.left_at is null
  order by c.created_at desc
$$;

create or replace function public.get_messages(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships;
begin
  select * into mem from memberships where conversation_id=conv and user_id=me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  perform _release_for(me, false);
  return query
    select msg.id, msg.sender_id, _label_for(me, msg.sender_id), msg.body, msg.created_at, msg.sender_id = me
    from messages msg
    where msg.conversation_id = conv and msg.created_at >= mem.joined_at
      and (msg.sender_id = me or exists (select 1 from message_deliveries d
             where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
    order by msg.created_at asc limit 500;
end $$;

drop function public.create_email_invitation(text, text);
create function public.create_email_invitation(p_email text)
returns table(invitation_id uuid, conversation_id uuid, token text, expires_at timestamptz, inviter_email text)
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); em text := lower(trim(p_email)); cid uuid; raw text; inv uuid;
  exp timestamptz := now() + interval '72 hours'; my_email text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 254 then raise exception 'bad_email' using errcode='22023'; end if;
  select email into my_email from auth.users where id = me;
  if lower(my_email) = em then raise exception 'bad_email' using errcode='22023'; end if;
  if (select count(*) from invitations where created_by = me and created_at > now() - interval '24 hours') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into conversations(title, created_by) values (null, me) returning id into cid;
  insert into memberships(conversation_id,user_id,role) values (cid, me, 'parent');
  raw := encode(gen_random_bytes(24),'hex');
  insert into invitations(conversation_id, created_by, role, token_hash, member_version, expires_at, invitee_email)
    values (cid, me, 'parent', digest(raw,'sha256'), 1, exp, em) returning id into inv;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, me, 1, 'parent');
  return query select inv, cid, raw, exp, my_email;
end $$;

drop function public.peek_invitation(text);
create function public.peek_invitation(p_token text)
returns table(inviter_email text, invitee_email text, expires_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select u.email, i.invitee_email, i.expires_at
  from invitations i join auth.users u on u.id = i.created_by
  where i.token_hash = digest(p_token,'sha256') and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

revoke execute on function public.list_my_conversations(), public.create_email_invitation(text), public.peek_invitation(text), public.set_contact_alias(uuid,text) from public, anon, authenticated;
grant execute on function public.list_my_conversations(), public.create_email_invitation(text), public.set_contact_alias(uuid,text) to authenticated;
grant execute on function public.peek_invitation(text) to anon, authenticated;
