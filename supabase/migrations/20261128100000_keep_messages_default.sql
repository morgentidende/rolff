-- Old messages are kept until the user deletes them (or their account). Decided 2026-11-28.
--
--  1. "Behold mine beskeder i": the default is now keep-forever. The stored value stays 'unlimited' (the app shows it as
--     "Indtil jeg sletter dem (standard)"); '1y' and '5y' remain optional. Only the DEFAULT changes: existing
--     user_privacy rows are NOT touched, because nothing records whether '1y' was chosen or just the old default
--     (see docs/keep-messages-default.md for the options). Users without a row now count as keep-forever.
--  2. Someone with a shorter limit gets ONE warning 3 days before their first messages would disappear: an e-mail
--     (sent by the daily inactivity-sweep function) and, if they opted in to notifications, a neutral push without any
--     message text. No account inactivity deletion exists (removed 26/11) and nothing else deletes automatically.
--     The warning is sent once per batch: after a warning, none is sent again for 30 days (messages that reach the
--     limit in between are covered by the same warning: older messages are then removed continuously); changing the
--     retention choice starts a new batch.

alter table public.user_privacy alter column retention set default 'unlimited';
alter table public.user_privacy add column if not exists retention_warned_at timestamptz;

-- No row = default = keep forever (was '1y').
create or replace function public._retention_cutoff(uid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case coalesce((select retention from user_privacy where user_id = uid), 'unlimited')
    when '1y' then now() - interval '1 year' when '5y' then now() - interval '5 years' else '-infinity'::timestamptz end
$$;
revoke execute on function public._retention_cutoff(uuid) from public, anon, authenticated;

-- A new retention choice starts a new warning batch.
create or replace function public.set_my_data_prefs(p_cloud_sync boolean, p_retention text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_retention not in ('1y','5y','unlimited') or p_cloud_sync is null then raise exception 'bad_input' using errcode='22023'; end if;
  if p_cloud_sync and _effective_plan(auth.uid()) is distinct from 'text_attachments' then
    raise exception 'plan_required' using errcode='42501';
  end if;
  insert into user_privacy(user_id, cloud_sync, retention) values (auth.uid(), p_cloud_sync, p_retention)
  on conflict (user_id) do update set cloud_sync = excluded.cloud_sync,
    retention_warned_at = case when user_privacy.retention is distinct from excluded.retention then null else user_privacy.retention_warned_at end,
    retention = excluded.retention, updated_at = now();
end $$;
revoke execute on function public.set_my_data_prefs(boolean,text) from public, anon;
grant execute on function public.set_my_data_prefs(boolean,text) to authenticated;

-- retention_sweep() is unchanged: it only removes a message when it is older than EVERY active member's own limit.
-- With keep-forever as the default, a member without a shorter choice protects the message indefinitely.

-- ---------------------------------------------------------------------------------------------------------------
-- Warning: is anything of this user's about to disappear?
create or replace function public._retention_span(r text) returns interval
language sql immutable set search_path = pg_catalog as $$
  select case r when '1y' then interval '1 year' when '5y' then interval '5 years' else null end
$$;
revoke execute on function public._retention_span(text) from public, anon, authenticated;

-- True when the user has a shorter limit and at least one message they can see passes it within p_ahead.
-- Same visibility as get_messages (active member, after joining, own or delivered).
create or replace function public.retention_has_expiring(uid uuid, p_ahead interval default interval '3 days') returns boolean
language plpgsql stable security definer set search_path = public as $$
declare span interval := _retention_span(coalesce((select retention from user_privacy where user_id = uid), 'unlimited'));
begin
  if span is null then return false; end if;
  return exists (
    select 1 from memberships mem
    join messages msg on msg.conversation_id = mem.conversation_id
    where mem.user_id = uid and mem.left_at is null
      and msg.created_at >= mem.joined_at
      and msg.created_at >= now() - span and msg.created_at < now() + p_ahead - span
      and (msg.sender_id = uid or exists (select 1 from message_deliveries d
             where d.message_id = msg.id and d.recipient_id = uid and d.released_at is not null)));
end $$;
revoke execute on function public.retention_has_expiring(uuid, interval) from public, anon, authenticated;
grant execute on function public.retention_has_expiring(uuid, interval) to service_role;

-- Push: a third kind of notification job. No conversation, no person, no message data.
alter table public.notification_jobs drop constraint notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check check (kind in ('messages','invite_accepted','retention_warning'));
alter table public.notification_jobs drop constraint notification_jobs_kind_shape;
alter table public.notification_jobs add constraint notification_jobs_kind_shape check (
  (kind = 'messages' and conversation_id is null and subject_id is null and invitation_id is null)
  or (kind = 'invite_accepted' and conversation_id is not null and subject_id is not null and invitation_id is not null)
  or (kind = 'retention_warning' and conversation_id is null and subject_id is null and invitation_id is null));

-- Daily, service role only. Marks the users as warned (once per batch), queues the push for those who opted in and
-- returns who should get the e-mail. The caller sends the mail and calls release_retention_warning() if it fails.
create or replace function public.claim_retention_warnings(p_ahead interval default interval '3 days')
returns table(user_id uuid, email text, lang text, retention text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select p.user_id from user_privacy p
    where p.retention in ('1y','5y')
      and (p.retention_warned_at is null or p.retention_warned_at < now() - interval '30 days')
      and public.retention_has_expiring(p.user_id, p_ahead)
    for update of p skip locked
  ), marked as (
    update user_privacy p set retention_warned_at = now() from due where p.user_id = due.user_id
    returning p.user_id, p.retention
  ), jobs as (
    insert into notification_jobs(user_id, kind)
    select m.user_id, 'retention_warning' from marked m
    where exists (select 1 from push_preferences pp where pp.user_id = m.user_id and pp.enabled)
    returning notification_jobs.user_id
  )
  select m.user_id, u.email::text, public.locale_of(m.user_id), m.retention
  from marked m join auth.users u on u.id = m.user_id;
end $$;
revoke all on function public.claim_retention_warnings(interval) from public, anon, authenticated;
grant execute on function public.claim_retention_warnings(interval) to service_role;

-- The mail could not be sent: forget the claim (and the not yet prepared push) so tomorrow's run tries again.
create or replace function public.release_retention_warning(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from notification_jobs where user_id = p_uid and kind = 'retention_warning' and prepared_at is null and completed_at is null;
  update user_privacy set retention_warned_at = null where user_id = p_uid;
end $$;
revoke all on function public.release_retention_warning(uuid) from public, anon, authenticated;
grant execute on function public.release_retention_warning(uuid) to service_role;

-- Pipeline hooks (same pattern as 'invite_accepted'): never suppressed by chat mute, follows the global receive times.
create or replace function public.notification_job_suppressed(uid uuid, p_job bigint, at timestamptz) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return false; end if;
  if j.kind = 'retention_warning' then
    -- Nothing left to warn about (they chose a longer time, or the messages are gone) -> close without sending.
    return not exists (select 1 from public.user_privacy p where p.user_id = uid and p.retention in ('1y','5y'));
  end if;
  if j.kind = 'invite_accepted' then
    return public.conversation_is_muted(uid, j.conversation_id, at)
        or not public.is_active_member(j.conversation_id, uid)
        or not public.is_active_member(j.conversation_id, j.subject_id);
  end if;
  return public.notification_job_all_muted(uid, p_job, at);
end $$;
revoke all on function public.notification_job_suppressed(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_job_suppressed(uuid, bigint, timestamptz) to service_role;

create or replace function public.notification_in_receive_window(uid uuid, at timestamptz, p_job bigint)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs; n int; ok int;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return false; end if;
  if j.kind = 'invite_accepted' then return public.in_receive_window(uid, at, j.conversation_id); end if;
  if j.kind = 'retention_warning' then return public.in_receive_window(uid, at); end if;
  select count(distinct m.conversation_id),
         count(distinct m.conversation_id) filter (where public.in_receive_window(uid, at, m.conversation_id))
    into n, ok
  from public.message_deliveries d
  join public.messages m on m.id = d.message_id
  where d.recipient_id = uid and d.released_at is not null
    and d.released_at >= j.created_at - interval '1 second';
  if coalesce(n, 0) = 0 then
    return public.in_receive_window(uid, at);
  end if;
  return ok = n;
end $$;

-- prepare_push: the retention notice carries only the flag 'ret' (the worker builds the fixed text). Message and
-- invitation jobs return exactly what they returned before.
create or replace function public.prepare_push(p_job bigint,p_sub uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.push_attempts; j public.notification_jobs; s public.push_subscriptions;
begin
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease and done_at is null and lease_until>clock_timestamp();
 if not found then return null; end if;
 select * into j from public.notification_jobs where id=p_job and completed_at is null and created_at>clock_timestamp()-interval '24 hours';
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||j.user_id::text,0)) then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:push:'||j.user_id::text,0)) then return null; end if;
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) or not exists(select 1 from public.push_preferences where user_id=j.user_id and enabled) or not public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id) or public.notification_job_suppressed(j.user_id,j.id,clock_timestamp()) then return null; end if;
 if j.kind='messages' and not exists(select 1 from public.message_deliveries where recipient_id=j.user_id and released_at is not null and released_at>=j.created_at-interval '1 second') then return null; end if;
 select * into s from public.push_subscriptions where id=p_sub and user_id=j.user_id and expires_at>clock_timestamp() and created_at<=j.created_at;
 if not found or not public._push_endpoint_ok(s.endpoint) then return null; end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.id,'lang',public.locale_of(j.user_id),'prepared_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 seconds')
  || case j.kind when 'messages' then jsonb_build_object('who',public.push_notice_who(j.user_id,j.id,clock_timestamp()))
                 when 'retention_warning' then jsonb_build_object('ret',true)
                 else jsonb_build_object('accept',public.push_accept_notice(j.user_id,j.id)) end;
end $$;
revoke all on function public.prepare_push(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_push(bigint,uuid,uuid) to service_role;
