-- auth.users.email is varchar(255); cast to text to match the declared result type.
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
  return query select raw, i.invitee_email, (select email::text from auth.users where id = i.created_by), raw is not null;
end $$;

create or replace function public.pending_approver_emails(inv uuid) returns table(email text)
language sql stable security definer set search_path = public as $$
  select u.email::text from invitations i join memberships m on m.conversation_id = i.conversation_id and m.left_at is null
  join auth.users u on u.id = m.user_id
  where i.id = inv and not exists (select 1 from invitation_consents ic where ic.invitation_id = i.id and ic.user_id = m.user_id)
$$;
