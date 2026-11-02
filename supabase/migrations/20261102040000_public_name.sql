-- Public display name (decision 2026-11-02): what others see is by default the user's e-mail;
-- the user can change it any time to a nickname. Login id stays the e-mail (Supabase email+password).
-- When public_name is set, NO API returns the e-mail to others. Names are computed on read, so a change
-- applies immediately in all existing conversations.
alter table public.profiles add column if not exists public_name text
  check (public_name is null or (char_length(public_name) between 1 and 40 and public_name !~ '[\r\n@]'));

create or replace function public._public_label(target uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(p.public_name),'') from profiles p where p.user_id = target),
                  (select email from auth.users where id = target), '?')
$$;
revoke execute on function public._public_label(uuid) from public, anon, authenticated;

create or replace function public._label_for(viewer uuid, target uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select alias from contact_aliases where owner_id = viewer and contact_user_id = target), _public_label(target))
$$;
revoke execute on function public._label_for(uuid,uuid) from public, anon, authenticated;

-- 'email' key now carries the PUBLIC label (e-mail only if no public name), never the raw e-mail otherwise.
create or replace function public.list_my_conversations()
returns table(id uuid, role public.member_role, members int, others jsonb, color text)
language sql stable security definer set search_path = public as $$
  select c.id, m.role, (select count(*)::int from memberships x where x.conversation_id=c.id and x.left_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'email', _public_label(o.user_id),
        'alias', (select alias from contact_aliases a where a.owner_id = auth.uid() and a.contact_user_id = o.user_id)) order by o.joined_at)
      from memberships o
      where o.conversation_id = c.id and o.left_at is null and o.user_id <> auth.uid()), '[]'::jsonb),
    (select p.color from conversation_prefs p where p.user_id = auth.uid() and p.conversation_id = c.id)
  from conversations c join memberships m on m.conversation_id=c.id and m.user_id=auth.uid() and m.left_at is null
  order by c.created_at desc
$$;

create or replace function public.peek_invitation(p_token text)
returns table(inviter_email text, invitee_email text, expires_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select _public_label(i.created_by), i.invitee_email, i.expires_at
  from invitations i
  where i.token_hash = digest(p_token,'sha256') and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

create or replace function public.get_my_public_name() returns text
language sql stable security definer set search_path = public as $$ select public_name from profiles where user_id = auth.uid() $$;
create or replace function public.set_my_public_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n text := nullif(trim(coalesce(p_name,'')),'');
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if n is not null and (char_length(n) > 40 or n ~ '[\r\n@]') then raise exception 'bad_name' using errcode='22023'; end if;
  update profiles set public_name = n where user_id = me;
end $$;
-- Service: label used in invitation mails sent to others.
create or replace function public.public_label_of(uid uuid) returns text
language sql stable security definer set search_path = public as $$ select _public_label(uid) $$;
revoke execute on function public.get_my_public_name(), public.set_my_public_name(text), public.public_label_of(uuid), public.peek_invitation(text) from public, anon, authenticated;
grant execute on function public.get_my_public_name(), public.set_my_public_name(text) to authenticated;
grant execute on function public.peek_invitation(text) to anon, authenticated;
grant execute on function public.public_label_of(uuid) to service_role;

-- Approval result no longer exposes the inviter's login e-mail to other members.
create or replace function public.consent_member_invitation(inv uuid)
returns table(token text, invitee_email text, inviter_email text, complete boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare i invitations; c conversations; raw text;
begin
  select * into i from invitations where id = inv for update;
  if not found or not public.is_active_member(i.conversation_id, auth.uid())
    or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then raise exception 'not_found' using errcode='P0002'; end if;
  select * into c from conversations where id = i.conversation_id;
  if c.member_version <> i.member_version then raise exception 'stale_invitation' using errcode='P0001'; end if;
  if exists (select 1 from invitation_consents where invitation_id = inv and user_id = auth.uid()) then
    return query select null::text, i.invitee_email, null::text, false; return; end if;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, auth.uid(), i.member_version, i.role);
  if _all_consented(i) then
    raw := encode(gen_random_bytes(24),'hex');
    update invitations set token_hash = digest(raw,'sha256'), expires_at = now() + interval '72 hours' where id = inv;
  end if;
  return query select raw, i.invitee_email, _public_label(i.created_by), raw is not null;
end $$;
