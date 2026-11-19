-- Per-user, per-conversation mute ("Lydløs"). Server-side only. It silences the neutral
-- push notification for that conversation until mute_until (null = always; 'infinity'
-- is treated the same). It never changes delivery or receive times, and the other
-- participants cannot read it: the table is owner-only (RLS) and no function returns
-- another user's mute.

create table public.conversation_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  mute_until timestamptz,            -- null = always
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_mutes enable row level security;
create policy conversation_mutes_owner_select on public.conversation_mutes
  for select to authenticated using (user_id = auth.uid());
-- Writes go only through the owner RPCs below (server clock, membership check).
revoke all on public.conversation_mutes from public, anon, authenticated;
grant select on public.conversation_mutes to authenticated;
grant all on public.conversation_mutes to service_role;

create function public.set_my_conversation_mute(conv uuid, p_duration text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); until_at timestamptz;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(conv, me) then raise exception 'not_member' using errcode='42501'; end if;
  until_at := case p_duration
    when '8h'  then clock_timestamp() + interval '8 hours'
    when '24h' then clock_timestamp() + interval '24 hours'
    when '1w'  then clock_timestamp() + interval '1 week'
    when 'always' then null
    else null end;
  if p_duration is null or p_duration not in ('8h','24h','1w','always') then
    raise exception 'invalid_duration' using errcode='22023';
  end if;
  delete from public.conversation_mutes where user_id = me and mute_until is not null and mute_until <= clock_timestamp();
  insert into public.conversation_mutes(user_id, conversation_id, mute_until) values (me, conv, until_at)
    on conflict (user_id, conversation_id) do update set mute_until = excluded.mute_until, created_at = clock_timestamp();
  return jsonb_build_object('muted', true, 'mute_until', until_at, 'always', until_at is null);
end $$;
revoke all on function public.set_my_conversation_mute(uuid, text) from public, anon;
grant execute on function public.set_my_conversation_mute(uuid, text) to authenticated;

create function public.clear_my_conversation_mute(conv uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  delete from public.conversation_mutes where user_id = me and conversation_id = conv;
end $$;
revoke all on function public.clear_my_conversation_mute(uuid) from public, anon;
grant execute on function public.clear_my_conversation_mute(uuid) to authenticated;

-- The caller's own active mutes only (expired rows are hidden).
create function public.my_conversation_mutes()
returns table(conversation_id uuid, mute_until timestamptz, always boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  return query
    select m.conversation_id,
           case when m.mute_until = 'infinity'::timestamptz then null else m.mute_until end,
           (m.mute_until is null or m.mute_until = 'infinity'::timestamptz)
    from public.conversation_mutes m
    where m.user_id = me and (m.mute_until is null or m.mute_until > clock_timestamp())
      and public.is_active_member(m.conversation_id, me);
end $$;
revoke all on function public.my_conversation_mutes() from public, anon;
grant execute on function public.my_conversation_mutes() to authenticated;

create function public.conversation_is_muted(uid uuid, conv uuid, at timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.conversation_mutes m
    where m.user_id = uid and m.conversation_id = conv and (m.mute_until is null or m.mute_until > at))
$$;
revoke all on function public.conversation_is_muted(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.conversation_is_muted(uuid, uuid, timestamptz) to service_role;

-- True when everything released with this job belongs to conversations the user has muted right now.
create function public.notification_job_all_muted(uid uuid, p_job bigint, at timestamptz)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs; n int; unmuted int;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return false; end if;
  select count(*), count(*) filter (where not public.conversation_is_muted(uid, m.conversation_id, at))
    into n, unmuted
  from public.message_deliveries d join public.messages m on m.id = d.message_id
  where d.recipient_id = uid and d.released_at is not null and d.released_at >= j.created_at - interval '1 second';
  return coalesce(n, 0) > 0 and unmuted = 0;
end $$;
revoke all on function public.notification_job_all_muted(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_job_all_muted(uuid, bigint, timestamptz) to service_role;

-- Release is unchanged (messages still arrive on the normal receive times). Only the push job
-- is skipped when every message released in this call belongs to a muted conversation.
create or replace function public._release_for(uid uuid, force boolean, conv uuid)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
declare n int; unmuted int;
begin
  if force then
    perform pg_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0));
  elsif not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0)) then
    return 0;
  end if;
  if not force and conv is not null and not public.in_receive_window(uid, clock_timestamp(), conv) then
    return 0;
  end if;
  with rel as (
    update public.message_deliveries d set released_at = clock_timestamp()
     where d.recipient_id = uid and d.released_at is null
       and exists (
         select 1 from public.messages m
         where m.id = d.message_id
           and (m.deliver_after is null or m.deliver_after <= clock_timestamp())
           and (conv is null or m.conversation_id = conv)
           and (force or public.in_receive_window(uid, clock_timestamp(), m.conversation_id))
       )
    returning d.message_id
  )
  select count(*), count(*) filter (where not public.conversation_is_muted(uid, m.conversation_id, clock_timestamp()))
    into n, unmuted
  from rel join public.messages m on m.id = rel.message_id;
  if unmuted > 0 then insert into public.notification_jobs(user_id) values (uid); end if;
  return n;
end $$;
revoke all on function public._release_for(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public._release_for(uuid, boolean, uuid) to service_role;

-- Dispatch skips muted conversations: a job whose messages are all in muted conversations is
-- closed without a push (so it cannot fire later when the mute ends).
create or replace function public.claim_push_work() returns table(job_id bigint,subscription_id uuid,lease uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.push_subscriptions where expires_at<=clock_timestamp();
 delete from public.notification_jobs where created_at<clock_timestamp()-interval '7 days';
 delete from public.conversation_mutes where mute_until is not null and mute_until<clock_timestamp()-interval '7 days';
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and
 (j.created_at<clock_timestamp()-interval '24 hours' or not exists(select 1 from public.push_preferences p where p.user_id=j.user_id and p.enabled)
  or public.notification_job_all_muted(j.user_id,j.id,clock_timestamp()));
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) then return; end if;
 with batch as (select id from public.notification_jobs where completed_at is null and prepared_at is null order by id for update skip locked limit 100),
 jobs as (update public.notification_jobs j set prepared_at=clock_timestamp() from batch b where b.id=j.id returning j.*)
 insert into public.push_attempts(job_id,subscription_id)
 select j.id,s.id from jobs j join public.push_subscriptions s on s.user_id=j.user_id
 where s.created_at<=j.created_at and s.expires_at>clock_timestamp() on conflict do nothing;
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and j.prepared_at is not null and not exists(select 1 from public.push_attempts a where a.job_id=j.id and a.done_at is null);
 return query
 with candidates as (
  select a.job_id,a.subscription_id from public.push_attempts a join public.notification_jobs j on j.id=a.job_id
  where a.done_at is null and a.attempts<5 and a.next_at<=clock_timestamp() and (a.lease_until is null or a.lease_until<clock_timestamp())
   and j.completed_at is null and public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id)
  order by a.job_id,a.subscription_id for update of a skip locked limit 10
 ), claimed as (
 update public.push_attempts a set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',attempts=a.attempts+1,handoff_id=null
 from candidates c where a.job_id=c.job_id and a.subscription_id=c.subscription_id returning a.job_id,a.subscription_id,a.lease
 ) select * from claimed;
end $$;

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
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) or not exists(select 1 from public.push_preferences where user_id=j.user_id and enabled) or not public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id) or public.notification_job_all_muted(j.user_id,j.id,clock_timestamp()) then return null; end if;
 if not exists(select 1 from public.message_deliveries where recipient_id=j.user_id and released_at is not null and released_at>=j.created_at-interval '1 second') then return null; end if;
 select * into s from public.push_subscriptions where id=p_sub and user_id=j.user_id and expires_at>clock_timestamp() and created_at<=j.created_at;
 if not found or not public._push_endpoint_ok(s.endpoint) then return null; end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.id,'lang',public.locale_of(j.user_id),'prepared_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 seconds');
end $$;

revoke all on function public.claim_push_work(),public.prepare_push(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_push_work(),public.prepare_push(bigint,uuid,uuid) to service_role;
