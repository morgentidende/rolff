-- Extra members (writer/reader) by e-mail with unanimous consent of ALL active members; decline stops it.
-- The usable token is only minted when the last consent arrives. Feedback table (insert-only).
alter table public.invitations add column declined_at timestamptz, add column declined_by uuid references auth.users(id);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null default 'other' check (category in ('idea','problem','other')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create policy feedback_own_insert on public.feedback for insert to authenticated with check (user_id = auth.uid());
revoke all on public.feedback from anon, authenticated;
grant insert (category, body) on public.feedback to authenticated;
grant all on public.feedback to service_role;

create or replace function public._all_consented(i public.invitations) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from memberships m where m.conversation_id = i.conversation_id and m.left_at is null
    and not exists (select 1 from invitation_consents ic where ic.invitation_id = i.id and ic.user_id = m.user_id and ic.member_version = i.member_version))
$$;
revoke execute on function public._all_consented(public.invitations) from public, anon, authenticated;

create or replace function public.create_member_invitation(conv uuid, p_email text, p_role public.member_role)
returns table(invitation_id uuid, token text, invitee_email text, inviter_email text, complete boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); c conversations; em text := lower(trim(p_email)); inv uuid; raw text; i invitations; my_email text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_role not in ('writer','reader') then raise exception 'bad_role' using errcode='22023'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 254 then raise exception 'bad_email' using errcode='22023'; end if;
  select * into c from conversations where id = conv for update;
  if not found or not exists (select 1 from memberships where conversation_id = conv and user_id = me and left_at is null and role = 'parent')
    then raise exception 'forbidden' using errcode='42501'; end if;
  if exists (select 1 from memberships m join auth.users u on u.id = m.user_id where m.conversation_id = conv and m.left_at is null and lower(u.email) = em)
    then raise exception 'bad_email' using errcode='22023'; end if;
  if (select count(*) from invitations where created_by = me and created_at > now() - interval '24 hours') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  select email into my_email from auth.users where id = me;
  -- placeholder hash: never revealed, so the invitation is unusable until everyone consents
  insert into invitations(conversation_id, created_by, role, token_hash, member_version, expires_at, invitee_email)
    values (conv, me, p_role, digest(gen_random_bytes(32),'sha256'), c.member_version, now() + interval '7 days', em) returning id into inv;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, me, c.member_version, p_role);
  select * into i from invitations where id = inv;
  if _all_consented(i) then
    raw := encode(gen_random_bytes(24),'hex');
    update invitations set token_hash = digest(raw,'sha256'), expires_at = now() + interval '72 hours' where id = inv;
  end if;
  return query select inv, raw, em, my_email, raw is not null;
end $$;

-- Any active member consents; when unanimous, a fresh token is minted and returned ONCE (for the mail).
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
  return query select raw, i.invitee_email, (select email from auth.users where id = i.created_by), raw is not null;
end $$;

create or replace function public.decline_invitation(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update invitations i set revoked_at = now(), declined_at = now(), declined_by = auth.uid()
   where i.id = inv and i.accepted_at is null and i.revoked_at is null and public.is_active_member(i.conversation_id, auth.uid());
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
end $$;

-- Acceptance now requires consent from ALL active members (any role), bound to member_version.
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); i invitations; c conversations; parents int; my_email text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into i from invitations where token_hash = digest(p_token,'sha256') for update;
  if not found or i.revoked_at is not null or i.accepted_at is not null or i.expires_at <= now()
    then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  if i.invitee_email is not null then
    select lower(email) into my_email from auth.users where id = me;
    if my_email is distinct from i.invitee_email then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  end if;
  select * into c from conversations where id = i.conversation_id for update;
  if c.member_version <> i.member_version then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  if exists(select 1 from memberships where conversation_id=c.id and user_id=me and left_at is null)
    then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  if not _all_consented(i) then raise exception 'consent_missing' using errcode='P0001'; end if;
  select count(*) into parents from memberships where conversation_id=c.id and left_at is null and role='parent';
  if i.role='parent' and parents >= 2 then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  update invitations set accepted_by=me, accepted_at=now() where id=i.id;
  insert into memberships(conversation_id,user_id,role) values (c.id, me, i.role);
  update conversations set member_version = member_version + 1 where id = c.id;
  return c.id;
end $$;

-- Old code-based consent: any active member may consent (not only parents).
create or replace function public.consent_invitation(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i invitations; c conversations;
begin
  select * into i from invitations where id = inv;
  if not found or not public.is_active_member(i.conversation_id, auth.uid()) then raise exception 'not_found' using errcode='P0002'; end if;
  select * into c from conversations where id = i.conversation_id;
  if c.member_version <> i.member_version then raise exception 'stale_invitation' using errcode='P0001'; end if;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, auth.uid(), i.member_version, i.role)
    on conflict (invitation_id,user_id) do nothing;
end $$;

drop function public.list_pending_invitations(uuid);
create function public.list_pending_invitations(conv uuid)
returns table(id uuid, role public.member_role, invitee_email text, expires_at timestamptz, consents int, required int, i_consented boolean, mine boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.role, i.invitee_email, i.expires_at,
    (select count(*)::int from invitation_consents ic join memberships m on m.conversation_id = i.conversation_id and m.user_id = ic.user_id and m.left_at is null
       where ic.invitation_id=i.id and ic.member_version=i.member_version),
    (select count(*)::int from memberships m where m.conversation_id=i.conversation_id and m.left_at is null),
    exists(select 1 from invitation_consents ic where ic.invitation_id=i.id and ic.user_id=auth.uid()),
    i.created_by = auth.uid()
  from invitations i join conversations c on c.id=i.conversation_id
  where i.conversation_id = conv and public.is_active_member(conv, auth.uid())
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and i.member_version = c.member_version
$$;

-- Server-only: e-mails of active members who still need to consent (for the approval-request mail).
create or replace function public.pending_approver_emails(inv uuid) returns table(email text)
language sql stable security definer set search_path = public as $$
  select u.email from invitations i join memberships m on m.conversation_id = i.conversation_id and m.left_at is null
  join auth.users u on u.id = m.user_id
  where i.id = inv and not exists (select 1 from invitation_consents ic where ic.invitation_id = i.id and ic.user_id = m.user_id)
$$;

revoke execute on function public.create_member_invitation(uuid,text,public.member_role), public.consent_member_invitation(uuid),
  public.decline_invitation(uuid), public.list_pending_invitations(uuid), public.pending_approver_emails(uuid), public.consent_invitation(uuid) from public, anon, authenticated;
grant execute on function public.create_member_invitation(uuid,text,public.member_role), public.consent_member_invitation(uuid),
  public.decline_invitation(uuid), public.list_pending_invitations(uuid), public.consent_invitation(uuid) to authenticated;
grant execute on function public.pending_approver_emails(uuid) to service_role;
