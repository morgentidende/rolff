-- E-mail invitations: token is the capability; acceptance is additionally bound to the invited address.
alter table public.invitations add column invitee_email text check (invitee_email = lower(invitee_email)),
  add column invitee_name text check (char_length(invitee_name) <= 60);

-- Creates a NEW 2-person conversation + parent invitation bound to an e-mail. Returns raw token once.
create or replace function public.create_email_invitation(p_name text, p_email text)
returns table(invitation_id uuid, conversation_id uuid, token text, expires_at timestamptz, inviter_name text, inviter_email text)
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); em text := lower(trim(p_email)); nm text := trim(p_name); cid uuid; raw text; inv uuid;
  exp timestamptz := now() + interval '72 hours'; my_name text; my_email text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 254 then raise exception 'bad_email' using errcode='22023'; end if;
  if char_length(nm) < 1 or char_length(nm) > 60 then raise exception 'bad_name' using errcode='22023'; end if;
  select email into my_email from auth.users where id = me;
  if lower(my_email) = em then raise exception 'bad_email' using errcode='22023'; end if;
  if (select count(*) from invitations where created_by = me and created_at > now() - interval '24 hours') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  select display_name into my_name from profiles where user_id = me;
  insert into conversations(title, created_by) values (left(coalesce(my_name,'?') || ' & ' || nm, 80), me) returning id into cid;
  insert into memberships(conversation_id,user_id,role) values (cid, me, 'parent');
  raw := encode(gen_random_bytes(24),'hex');
  insert into invitations(conversation_id, created_by, role, token_hash, member_version, expires_at, invitee_email, invitee_name)
    values (cid, me, 'parent', digest(raw,'sha256'), 1, exp, em, nm) returning id into inv;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, me, 1, 'parent');
  return query select inv, cid, raw, exp, coalesce(my_name,''), my_email;
end $$;

-- Public peek for the invite landing page: reveals nothing unless the token is valid.
create or replace function public.peek_invitation(p_token text)
returns table(inviter_name text, invitee_name text, invitee_email text, expires_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select p.display_name, i.invitee_name, i.invitee_email, i.expires_at
  from invitations i left join profiles p on p.user_id = i.created_by
  where i.token_hash = digest(p_token,'sha256') and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); i invitations; c conversations; needed int; have int; my_email text;
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
  select count(*) into needed from memberships where conversation_id=c.id and left_at is null and role='parent';
  select count(*) into have from invitation_consents ic join memberships m
    on m.conversation_id=c.id and m.user_id=ic.user_id and m.left_at is null and m.role='parent'
    where ic.invitation_id=i.id and ic.member_version=c.member_version and ic.role=i.role;
  if have < needed then raise exception 'consent_missing' using errcode='P0001'; end if;
  if i.role='parent' and needed >= 2 then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  update invitations set accepted_by=me, accepted_at=now() where id=i.id;
  insert into memberships(conversation_id,user_id,role) values (c.id, me, i.role);
  update conversations set member_version = member_version + 1 where id = c.id;
  return c.id;
end $$;

revoke execute on function public.create_email_invitation(text,text), public.peek_invitation(text), public.accept_invitation(text) from public, anon, authenticated;
grant execute on function public.create_email_invitation(text,text), public.accept_invitation(text) to authenticated;
grant execute on function public.peek_invitation(text) to anon, authenticated;
