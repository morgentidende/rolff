-- Per-conversation receive-time windows (Modtagetider).
--
-- New conversations copy the user's last-saved defaults (the existing
-- receive_settings / receive_windows row, which is updated whenever the user
-- saves a conversation's times). If a conversation has no row of its own,
-- in_receive_window falls back to that global setting (or always receives
-- when none exists). The sheet shows the same inherited times so the UI and
-- delivery stay in sync. The current editable default when turning times on
-- is still Mon–Sun 18:00–19:00.
--
-- Existing active memberships get a snapshot of the current global windows
-- and timezone at release, so behaviour does not change.

create table public.conversation_receive_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  timezone text not null default 'Europe/Copenhagen',
  enabled boolean not null default false,
  timezone_mode text not null default 'fixed' check (timezone_mode in ('auto','fixed')),
  timezone_device_id uuid,
  timezone_revision bigint not null default 0,
  timezone_synced_at timestamptz,
  primary key (user_id, conversation_id),
  constraint conversation_receive_timezone_controller
    check ((timezone_mode = 'fixed' and timezone_device_id is null)
        or (timezone_mode = 'auto' and timezone_device_id is not null))
);

create table public.conversation_receive_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null,
  weekday int not null check (weekday between 1 and 7),
  start_minute int not null check (start_minute between 0 and 1439),
  end_minute int not null check (end_minute between 0 and 1440),
  check (start_minute <> end_minute),
  foreign key (user_id, conversation_id)
    references public.conversation_receive_settings(user_id, conversation_id) on delete cascade
);
create index conversation_receive_windows_owner
  on public.conversation_receive_windows(user_id, conversation_id, weekday);

alter table public.conversation_receive_settings enable row level security;
alter table public.conversation_receive_windows enable row level security;
revoke all on public.conversation_receive_settings, public.conversation_receive_windows
  from public, anon, authenticated;
grant all on public.conversation_receive_settings, public.conversation_receive_windows to service_role;

-- Snapshot current global times onto every active membership (no behaviour change).
insert into public.conversation_receive_settings(
  user_id, conversation_id, timezone, enabled, timezone_mode, timezone_device_id,
  timezone_revision, timezone_synced_at
)
select m.user_id, m.conversation_id, s.timezone, s.enabled, s.timezone_mode, s.timezone_device_id,
       s.timezone_revision, s.timezone_synced_at
from public.memberships m
join public.receive_settings s on s.user_id = m.user_id
where m.left_at is null
on conflict (user_id, conversation_id) do nothing;

insert into public.conversation_receive_windows(user_id, conversation_id, weekday, start_minute, end_minute)
select s.user_id, s.conversation_id, w.weekday, w.start_minute, w.end_minute
from public.conversation_receive_settings s
join public.receive_windows w on w.user_id = s.user_id
where not exists (
  select 1 from public.conversation_receive_windows x
  where x.user_id = s.user_id and x.conversation_id = s.conversation_id
);

-- Seed a new membership from the user's last-saved defaults (global template).
create function public._seed_conversation_receive_settings_for(p_user uuid, p_conv uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.receive_settings;
begin
  if exists (
    select 1 from public.conversation_receive_settings c
    where c.user_id = p_user and c.conversation_id = p_conv
  ) then return; end if;
  select * into s from public.receive_settings where user_id = p_user;
  if not found then return; end if;
  insert into public.conversation_receive_settings(
    user_id, conversation_id, timezone, enabled, timezone_mode, timezone_device_id,
    timezone_revision, timezone_synced_at
  ) values (
    p_user, p_conv, s.timezone, s.enabled, s.timezone_mode, s.timezone_device_id,
    1, s.timezone_synced_at
  );
  insert into public.conversation_receive_windows(user_id, conversation_id, weekday, start_minute, end_minute)
    select p_user, p_conv, w.weekday, w.start_minute, w.end_minute
    from public.receive_windows w where w.user_id = p_user;
end $$;
revoke all on function public._seed_conversation_receive_settings_for(uuid,uuid) from public, anon, authenticated;

create function public._seed_conversation_receive_settings()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.left_at is null then
    perform public._seed_conversation_receive_settings_for(new.user_id, new.conversation_id);
  end if;
  return new;
end $$;
revoke all on function public._seed_conversation_receive_settings() from public, anon, authenticated;

create trigger memberships_seed_receive_settings
  after insert on public.memberships
  for each row execute function public._seed_conversation_receive_settings();

-- Also seed when someone rejoins (left_at cleared).
create function public._rejoin_conversation_receive_settings()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.left_at is not null and new.left_at is null then
    perform public._seed_conversation_receive_settings_for(new.user_id, new.conversation_id);
  end if;
  return new;
end $$;
revoke all on function public._rejoin_conversation_receive_settings() from public, anon, authenticated;

create trigger memberships_rejoin_receive_settings
  after update of left_at on public.memberships
  for each row execute function public._rejoin_conversation_receive_settings();

-- Core window check. A conversation with no row of its own uses the global
-- setting (two-argument form). New memberships are seeded from the last-saved
-- global template when that template exists, so most chats have their own row.
create function public.in_receive_window(uid uuid, at timestamptz, conv uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare s_enabled boolean; s_tz text; local_ts timestamp; dow int; mins int; prev_dow int; has_row boolean := false;
begin
  if conv is not null then
    select enabled, timezone into s_enabled, s_tz
      from public.conversation_receive_settings
      where user_id = uid and conversation_id = conv;
    has_row := found;
  end if;
  if not has_row then
    -- Fail-safe: no per-conversation row means "use the user's global windows".
    -- That keeps existing callers and chats created before the first save
    -- consistent with the template the sheet also shows as inherited times.
    return public.in_receive_window(uid, at);
  end if;
  if not s_enabled then return true; end if;
  local_ts := at at time zone s_tz;
  dow := extract(isodow from local_ts)::int;
  mins := extract(hour from local_ts)::int * 60 + extract(minute from local_ts)::int;
  prev_dow := case when dow = 1 then 7 else dow - 1 end;
  return exists (
    select 1 from public.conversation_receive_windows w
    where w.user_id = uid and w.conversation_id = conv and (
      (w.start_minute < w.end_minute and w.weekday = dow and mins >= w.start_minute and mins < w.end_minute)
      or (w.start_minute > w.end_minute and w.weekday = dow and mins >= w.start_minute)
      or (w.start_minute > w.end_minute and w.weekday = prev_dow and mins < w.end_minute)
    ));
end $$;
revoke all on function public.in_receive_window(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.in_receive_window(uuid, timestamptz, uuid) to service_role;

-- Push may only go out when every conversation released with this job is currently in window.
-- Force-receive can show messages immediately, but notifications still wait (existing contract).
create function public.notification_in_receive_window(uid uuid, at timestamptz, p_job bigint)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs; n int; ok int;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return false; end if;
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
revoke all on function public.notification_in_receive_window(uuid, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.notification_in_receive_window(uuid, timestamptz, bigint) to service_role;

create or replace function public._release_for(uid uuid, force boolean)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return public._release_for(uid, force, null);
end $$;

create function public._release_for(uid uuid, force boolean, conv uuid)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
declare n int;
begin
  if force then
    perform pg_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0));
  elsif not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0)) then
    return 0;
  end if;
  if not force and conv is not null and not public.in_receive_window(uid, clock_timestamp(), conv) then
    return 0;
  end if;
  update public.message_deliveries d set released_at = clock_timestamp()
   where d.recipient_id = uid and d.released_at is null
     and exists (
       select 1 from public.messages m
       where m.id = d.message_id
         and (m.deliver_after is null or m.deliver_after <= clock_timestamp())
         and (conv is null or m.conversation_id = conv)
         and (force or public.in_receive_window(uid, clock_timestamp(), m.conversation_id))
     );
  get diagnostics n = row_count;
  if n > 0 then insert into public.notification_jobs(user_id) values (uid); end if;
  return n;
end $$;
revoke all on function public._release_for(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public._release_for(uuid, boolean, uuid) to service_role;

drop function public.my_pending_count();
create function public.my_pending_count(p_conv uuid default null)
returns int language sql stable security definer set search_path = pg_catalog, public as $$
  select count(*)::int
  from public.message_deliveries d
  join public.messages m on m.id = d.message_id
  where d.recipient_id = auth.uid() and d.released_at is null
    and (m.deliver_after is null or m.deliver_after <= clock_timestamp())
    and (p_conv is null or m.conversation_id = p_conv)
$$;
revoke all on function public.my_pending_count(uuid) from public, anon;
grant execute on function public.my_pending_count(uuid) to authenticated;

drop function public.receive_now();
create function public.receive_now(p_conv uuid default null)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_conv is not null and not public.is_active_member(p_conv, auth.uid()) then
    raise exception 'not_member' using errcode='42501';
  end if;
  return public._release_for(auth.uid(), true, p_conv);
end $$;
revoke all on function public.receive_now(uuid) from public, anon;
grant execute on function public.receive_now(uuid) to authenticated;

create function public._conversation_receive_result(p_uid uuid, p_conv uuid, p_device uuid)
returns jsonb language plpgsql stable set search_path = pg_catalog, public as $$
declare s public.conversation_receive_settings; w jsonb; g public.receive_settings; gw jsonb;
begin
  select * into s from public.conversation_receive_settings
    where user_id = p_uid and conversation_id = p_conv;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'start_minute',start_minute,'end_minute',end_minute)
      order by weekday,start_minute,end_minute),'[]'::jsonb)
      into w from public.conversation_receive_windows
      where user_id = p_uid and conversation_id = p_conv;
    return jsonb_build_object('configured',true,'timezone',s.timezone,'mode',s.timezone_mode,
      'revision',s.timezone_revision,'enabled',s.enabled,'windows',w,
      'is_controller',coalesce(s.timezone_mode='auto' and s.timezone_device_id=p_device,false),
      'synced_at',s.timezone_synced_at);
  end if;
  -- Fail-safe: show the global template so the user can save a conversation row.
  select * into g from public.receive_settings where user_id = p_uid;
  if not found then
    return jsonb_build_object('configured',false,'timezone',null,'mode','auto','revision',0,
      'enabled',false,'windows','[]'::jsonb,'is_controller',false,'synced_at',null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'start_minute',start_minute,'end_minute',end_minute)
    order by weekday,start_minute,end_minute),'[]'::jsonb)
    into gw from public.receive_windows where user_id = p_uid;
  return jsonb_build_object('configured',false,'timezone',g.timezone,'mode',g.timezone_mode,
    'revision',0,'enabled',g.enabled,'windows',gw,
    'is_controller',coalesce(g.timezone_mode='auto' and g.timezone_device_id=p_device,false),
    'synced_at',g.timezone_synced_at);
end $$;
revoke all on function public._conversation_receive_result(uuid,uuid,uuid) from public, anon, authenticated;

create function public.get_my_conversation_receive_settings(p_conv uuid, p_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(p_conv, auth.uid()) then raise exception 'not_member' using errcode='42501'; end if;
  return public._conversation_receive_result(auth.uid(), p_conv, p_device_id);
end $$;
revoke all on function public.get_my_conversation_receive_settings(uuid,uuid) from public, anon;
grant execute on function public.get_my_conversation_receive_settings(uuid,uuid) to authenticated;

-- Last-saved defaults: a conversation save also updates the global template used for new chats.
create function public._write_receive_template(p_uid uuid, p_enabled boolean, p_windows jsonb,
  p_mode text, p_timezone text, p_controller uuid, p_synced timestamptz)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  insert into public.receive_settings(user_id,timezone,enabled,timezone_mode,timezone_device_id,timezone_revision,timezone_synced_at)
    values(p_uid,p_timezone,p_enabled,p_mode,p_controller,1,p_synced)
    on conflict(user_id) do update set timezone=excluded.timezone, enabled=excluded.enabled,
      timezone_mode=excluded.timezone_mode, timezone_device_id=excluded.timezone_device_id,
      timezone_revision=public.receive_settings.timezone_revision+1,
      timezone_synced_at=excluded.timezone_synced_at;
  delete from public.receive_windows where user_id=p_uid;
  insert into public.receive_windows(user_id,weekday,start_minute,end_minute)
    select p_uid,(value->>'weekday')::int,(value->>'start_minute')::int,(value->>'end_minute')::int
    from jsonb_array_elements(p_windows);
end $$;
revoke all on function public._write_receive_template(uuid,boolean,jsonb,text,text,uuid,timestamptz)
  from public, anon, authenticated;

create function public.save_my_conversation_receive_settings(
  p_conv uuid, p_enabled boolean, p_windows jsonb, p_mode text, p_timezone text,
  p_device_id uuid, p_expected_revision bigint, p_take_over boolean default false
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid:=auth.uid(); s public.conversation_receive_settings; had boolean;
  controller uuid; synced timestamptz; w jsonb; d int; a int; b int;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(p_conv, me) then raise exception 'not_member' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rolff:receive:'||me::text,0));
  select * into s from public.conversation_receive_settings
    where user_id=me and conversation_id=p_conv for update;
  had:=found;
  if p_expected_revision is distinct from (case when had then s.timezone_revision else 0 end) then
    raise exception 'settings_conflict' using errcode='40001';
  end if;
  if p_enabled is null or p_mode is null or p_mode not in ('auto','fixed') or p_take_over is null then
    raise exception 'invalid_settings' using errcode='22023';
  end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone)
    or not (p_timezone='UTC' or (position('/' in p_timezone)>0 and p_timezone !~ '^(posix|right)/')
            or (had and p_timezone=s.timezone)) then
    raise exception 'invalid_timezone' using errcode='22023';
  end if;
  if jsonb_typeof(p_windows) is distinct from 'array' then raise exception 'invalid_windows' using errcode='22023'; end if;
  if jsonb_array_length(p_windows)>128 then raise exception 'invalid_windows' using errcode='22023'; end if;
  if p_enabled and jsonb_array_length(p_windows)=0 then raise exception 'windows_required' using errcode='22023'; end if;
  for w in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(w) is distinct from 'object'
      or jsonb_typeof(w->'weekday') is distinct from 'number'
      or jsonb_typeof(w->'start_minute') is distinct from 'number'
      or jsonb_typeof(w->'end_minute') is distinct from 'number'
      or (w->>'weekday') !~ '^[0-9]+$' or (w->>'start_minute') !~ '^[0-9]+$' or (w->>'end_minute') !~ '^[0-9]+$' then
      raise exception 'invalid_windows' using errcode='22023';
    end if;
    begin d:=(w->>'weekday')::int; a:=(w->>'start_minute')::int; b:=(w->>'end_minute')::int;
    exception when numeric_value_out_of_range then raise exception 'invalid_windows' using errcode='22023'; end;
    if d not between 1 and 7 or a not between 0 and 1439 or b not between 0 and 1440 or a=b then
      raise exception 'invalid_windows' using errcode='22023';
    end if;
  end loop;
  if p_mode='auto' then
    if had and s.timezone_mode='auto' and s.timezone_device_id is distinct from p_device_id and not p_take_over then
      if p_timezone is distinct from s.timezone then raise exception 'timezone_control_required' using errcode='42501'; end if;
      controller:=s.timezone_device_id; synced:=s.timezone_synced_at;
    else
      if p_device_id is null then raise exception 'device_required' using errcode='22023'; end if;
      controller:=p_device_id; synced:=clock_timestamp();
    end if;
  else controller:=null; synced:=null;
  end if;
  insert into public.conversation_receive_settings(
    user_id,conversation_id,timezone,enabled,timezone_mode,timezone_device_id,timezone_revision,timezone_synced_at)
    values(me,p_conv,p_timezone,p_enabled,p_mode,controller,case when had then s.timezone_revision+1 else 1 end,synced)
    on conflict (user_id, conversation_id) do update set
      timezone=excluded.timezone, enabled=excluded.enabled, timezone_mode=excluded.timezone_mode,
      timezone_device_id=excluded.timezone_device_id, timezone_revision=excluded.timezone_revision,
      timezone_synced_at=excluded.timezone_synced_at;
  delete from public.conversation_receive_windows where user_id=me and conversation_id=p_conv;
  insert into public.conversation_receive_windows(user_id,conversation_id,weekday,start_minute,end_minute)
    select me,p_conv,(value->>'weekday')::int,(value->>'start_minute')::int,(value->>'end_minute')::int
    from jsonb_array_elements(p_windows);
  perform public._write_receive_template(me,p_enabled,p_windows,p_mode,p_timezone,controller,synced);
  return public._conversation_receive_result(me,p_conv,p_device_id);
end $$;
revoke all on function public.save_my_conversation_receive_settings(uuid,boolean,jsonb,text,text,uuid,bigint,boolean)
  from public, anon;
grant execute on function public.save_my_conversation_receive_settings(uuid,boolean,jsonb,text,text,uuid,bigint,boolean)
  to authenticated;

create function public.sync_my_conversation_receive_timezone(
  p_conv uuid, p_timezone text, p_device_id uuid, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid:=auth.uid(); s public.conversation_receive_settings;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(p_conv, me) then raise exception 'not_member' using errcode='42501'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone)
    or not (p_timezone='UTC' or (position('/' in p_timezone)>0 and p_timezone !~ '^(posix|right)/')) then
    raise exception 'invalid_timezone' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rolff:receive:'||me::text,0));
  select * into s from public.conversation_receive_settings
    where user_id=me and conversation_id=p_conv for update;
  if not found then raise exception 'receive_settings_missing' using errcode='22023'; end if;
  if p_expected_revision is distinct from s.timezone_revision then raise exception 'settings_conflict' using errcode='40001'; end if;
  if s.timezone_mode is distinct from 'auto' or s.timezone_device_id is distinct from p_device_id then
    raise exception 'timezone_not_controller' using errcode='42501';
  end if;
  update public.conversation_receive_settings
    set timezone=p_timezone, timezone_revision=timezone_revision+1, timezone_synced_at=clock_timestamp()
    where user_id=me and conversation_id=p_conv;
  update public.receive_settings
    set timezone=p_timezone, timezone_revision=timezone_revision+1, timezone_synced_at=clock_timestamp()
    where user_id=me and timezone_mode='auto' and timezone_device_id is not distinct from p_device_id;
  return public._conversation_receive_result(me,p_conv,p_device_id);
end $$;
revoke all on function public.sync_my_conversation_receive_timezone(uuid,text,uuid,bigint) from public, anon;
grant execute on function public.sync_my_conversation_receive_timezone(uuid,text,uuid,bigint) to authenticated;

-- Open-app sync: update every conversation this device controls, plus the global template.
create function public.sync_my_conversation_receive_timezones(p_timezone text, p_device_id uuid)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid:=auth.uid(); n int;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_device_id is null or p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone)
    or not (p_timezone='UTC' or (position('/' in p_timezone)>0 and p_timezone !~ '^(posix|right)/')) then
    raise exception 'invalid_timezone' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rolff:receive:'||me::text,0));
  update public.conversation_receive_settings
    set timezone=p_timezone, timezone_revision=timezone_revision+1, timezone_synced_at=clock_timestamp()
    where user_id=me and timezone_mode='auto' and timezone_device_id is not distinct from p_device_id
      and timezone is distinct from p_timezone;
  get diagnostics n = row_count;
  update public.receive_settings
    set timezone=p_timezone, timezone_revision=timezone_revision+1, timezone_synced_at=clock_timestamp()
    where user_id=me and timezone_mode='auto' and timezone_device_id is not distinct from p_device_id
      and timezone is distinct from p_timezone;
  return n;
end $$;
revoke all on function public.sync_my_conversation_receive_timezones(text,uuid) from public, anon;
grant execute on function public.sync_my_conversation_receive_timezones(text,uuid) to authenticated;

-- Push dispatch uses the per-conversation window of the job's released deliveries.
create or replace function public.claim_push_work() returns table(job_id bigint,subscription_id uuid,lease uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.push_subscriptions where expires_at<=clock_timestamp();
 delete from public.notification_jobs where created_at<clock_timestamp()-interval '7 days';
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and
 (j.created_at<clock_timestamp()-interval '24 hours' or not exists(select 1 from public.push_preferences p where p.user_id=j.user_id and p.enabled));
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
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) or not exists(select 1 from public.push_preferences where user_id=j.user_id and enabled) or not public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id) then return null; end if;
 if not exists(select 1 from public.message_deliveries where recipient_id=j.user_id and released_at is not null and released_at>=j.created_at-interval '1 second') then return null; end if;
 select * into s from public.push_subscriptions where id=p_sub and user_id=j.user_id and expires_at>clock_timestamp() and created_at<=j.created_at;
 if not found or not public._push_endpoint_ok(s.endpoint) then return null; end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.id,'lang',public.locale_of(j.user_id),'prepared_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 seconds');
end $$;

create or replace function public.handoff_push(p_job bigint,p_sub uuid,p_lease uuid,p_request_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid; a public.push_attempts; proof jsonb; at_time timestamptz; deadline timestamptz; result uuid;
begin
 if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request_hash' using errcode='22023'; end if;
 select user_id into uid from public.notification_jobs where id=p_job and completed_at is null;
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0)) then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:push:'||uid::text,0)) then return null; end if;
 begin perform 1 from public.push_runtime where singleton for share nowait;
 exception when lock_not_available then return null; end;
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease
  and done_at is null and handoff_id is null and lease_until>clock_timestamp() for update skip locked;
 if not found then return null; end if;
 proof:=public.prepare_push(p_job,p_sub,p_lease);
 if proof is null then return null; end if;
 at_time:=clock_timestamp();
 if not public.notification_in_receive_window(uid,at_time,p_job) then return null; end if;
 deadline:=least(at_time+interval '750 milliseconds',date_trunc('minute',at_time)+interval '1 minute');
 insert into public.push_handoffs(job_id,subscription_id,user_id,lease,request_hash,intent_at,valid_until)
 values(p_job,p_sub,uid,p_lease,p_request_hash,at_time,deadline) returning id into result;
 update public.push_attempts set handoff_id=result where job_id=p_job and subscription_id=p_sub;
 return jsonb_build_object('id',result,'valid_for_ms',floor(extract(epoch from deadline-at_time)*1000)::int);
end $$;

create or replace function public.export_user_data(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if (select count(*) from export_log where user_id = p_uid and created_at > now() - interval '24 hours') >= 3
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into export_log(user_id) values (p_uid);
  select jsonb_build_object(
    'account', (select jsonb_build_object('user_id', u.id, 'email', u.email, 'created_at', u.created_at) from auth.users u where u.id = p_uid),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'public_name', p.public_name, 'locale', p.locale, 'theme', p.theme, 'ai_consent_at', p.ai_consent_at) from profiles p where p.user_id = p_uid),
    'privacy_settings', (select to_jsonb(x) - 'user_id' from user_privacy x where x.user_id = p_uid),
    'receive_settings', (select to_jsonb(x) - 'user_id' from receive_settings x where x.user_id = p_uid),
    'receive_windows', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' - 'id') from receive_windows x where x.user_id = p_uid), '[]'),
    'conversation_receive_settings', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from conversation_receive_settings x where x.user_id = p_uid), '[]'),
    'conversation_receive_windows', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' - 'id') from conversation_receive_windows x where x.user_id = p_uid), '[]'),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id, 'role', m.role, 'joined_at', m.joined_at, 'left_at', m.left_at)) from memberships m where m.user_id = p_uid), '[]'),
    'own_private_aliases', coalesce((select jsonb_agg(jsonb_build_object('contact_user_id', a.contact_user_id, 'alias', a.alias)) from contact_aliases a where a.owner_id = p_uid), '[]'),
    'own_blocked_topics', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_topics w where w.user_id = p_uid), '[]'),
    'own_blocked_words', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_words w where w.user_id = p_uid), '[]'),
    'own_attachment_blocks', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', b.conversation_id, 'block_photos', b.block_photos, 'block_files', b.block_files, 'updated_at', b.updated_at)) from conversation_attachment_blocks b where b.user_id = p_uid), '[]'),
    'own_conversation_blocks', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', b.conversation_id, 'created_at', b.created_at)) from conversation_blocks b where b.user_id = p_uid), '[]'),
    'invitations_created', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', i.conversation_id, 'role', i.role, 'invitee_email', i.invitee_email, 'created_at', i.created_at, 'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at)) from invitations i where i.created_by = p_uid), '[]'),
    'consents_given', coalesce((select jsonb_agg(jsonb_build_object('invitation_id', c.invitation_id, 'role', c.role, 'created_at', c.created_at)) from invitation_consents c where c.user_id = p_uid), '[]'),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('category', f.category, 'body', f.body, 'created_at', f.created_at)) from feedback f where f.user_id = p_uid), '[]'),
    'reports_metadata', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', r2.conversation_id, 'category', r2.category, 'attached_count', r2.attached_count, 'created_at', r2.created_at)) from report_log r2 where r2.user_id = p_uid), '[]'),
    'moderation_attempts_metadata', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', a.conversation_id, 'decision', a.decision, 'reason_code', a.reason_code, 'created_at', a.created_at)) from moderation_attempts a where a.sender_id = p_uid), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.export_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
