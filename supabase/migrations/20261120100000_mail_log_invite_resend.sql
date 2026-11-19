-- Invitation mail reliability:
--  * mail_log: server-only delivery log (status, provider code, hashed recipient, kind). Never content.
--  * Invitations no longer get stuck when a mail fails: the link can be re-minted (resend / copy link),
--    rate-limited per invitation, and the last mail failure is remembered so the app can say so.
--  * list_pending_invitations also returns recently expired invitations (marked expired) so they can be
--    renewed or removed instead of silently disappearing.

create table if not exists public.mail_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (char_length(kind) <= 40),
  status text not null check (status in ('sent','failed')),
  provider text not null check (provider in ('smtp','relay','none')),
  response_code int,
  reason text check (char_length(reason) <= 80),
  recipient_hash text check (char_length(recipient_hash) <= 128)
);
create index if not exists mail_log_created_at_idx on public.mail_log(created_at);
alter table public.mail_log enable row level security;
-- No policies: only the service role (bypassrls) may read or write it.
revoke all on table public.mail_log from public, anon, authenticated;
grant select, insert, delete on table public.mail_log to service_role;

alter table public.invitations
  add column if not exists mail_failed_at timestamptz,
  add column if not exists reissued_at timestamptz,
  add column if not exists reissue_count int not null default 0,
  add column if not exists reissue_window_start timestamptz;

-- Re-mint a fresh one-time link for a pending, fully approved invitation (also renews an expired one).
-- The previous link stops working. Caller must be an active parent member. Rate limit: 30 s between
-- re-mints and at most 10 per invitation per 24 hours.
create or replace function public.reissue_invitation_link(inv uuid)
returns table(token text, invitee_email text, inviter_email text, role public.member_role, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); i invitations; c conversations; raw text; exp timestamptz := now() + interval '72 hours'; n int;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into i from invitations where id = inv for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null
    or not exists (select 1 from memberships m where m.conversation_id = i.conversation_id and m.user_id = me and m.left_at is null and m.role = 'parent')
    then raise exception 'not_found' using errcode='P0002'; end if;
  select * into c from conversations where id = i.conversation_id;
  if c.member_version <> i.member_version then raise exception 'stale_invitation' using errcode='P0001'; end if;
  if not _all_consented(i) then raise exception 'not_ready' using errcode='P0001'; end if;
  if i.reissued_at is not null and i.reissued_at > now() - interval '30 seconds' then raise exception 'rate_limited' using errcode='P0001'; end if;
  n := case when i.reissue_window_start is null or i.reissue_window_start <= now() - interval '24 hours' then 0 else i.reissue_count end;
  if n >= 10 then raise exception 'rate_limited' using errcode='P0001'; end if;
  raw := encode(gen_random_bytes(24),'hex');
  update invitations set token_hash = digest(raw,'sha256'), expires_at = exp, reissued_at = now(),
    reissue_count = n + 1, reissue_window_start = case when n = 0 then now() else reissue_window_start end
   where id = inv;
  return query select raw, i.invitee_email, _public_label(i.created_by), i.role, exp;
end $$;

-- Server-only: remember whether the last invitation mail went out.
create or replace function public.set_invitation_mail_status(inv uuid, ok boolean)
returns void language sql security definer set search_path = public as $$
  update invitations set mail_failed_at = case when ok then null else now() end where id = inv;
$$;

drop function if exists public.list_pending_invitations(uuid);
create function public.list_pending_invitations(conv uuid)
returns table(id uuid, role public.member_role, invitee_email text, expires_at timestamptz, consents int, required int,
  i_consented boolean, mine boolean, expired boolean, mail_failed boolean, can_manage boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.role, i.invitee_email, i.expires_at,
    (select count(*)::int from invitation_consents ic join memberships m on m.conversation_id = i.conversation_id and m.user_id = ic.user_id and m.left_at is null
       where ic.invitation_id=i.id and ic.member_version=i.member_version),
    (select count(*)::int from memberships m where m.conversation_id=i.conversation_id and m.left_at is null),
    exists(select 1 from invitation_consents ic where ic.invitation_id=i.id and ic.user_id=auth.uid()),
    i.created_by = auth.uid(),
    i.expires_at <= now(),
    i.mail_failed_at is not null,
    exists(select 1 from memberships m where m.conversation_id = i.conversation_id and m.user_id = auth.uid() and m.left_at is null and m.role = 'parent')
  from invitations i join conversations c on c.id=i.conversation_id
  where i.conversation_id = conv and public.is_active_member(conv, auth.uid())
    and i.accepted_at is null and i.revoked_at is null and i.member_version = c.member_version
    and i.expires_at > now() - interval '30 days'
$$;

revoke execute on function public.reissue_invitation_link(uuid), public.set_invitation_mail_status(uuid, boolean),
  public.list_pending_invitations(uuid) from public, anon, authenticated;
grant execute on function public.reissue_invitation_link(uuid), public.list_pending_invitations(uuid) to authenticated;
grant execute on function public.set_invitation_mail_status(uuid, boolean) to service_role;
