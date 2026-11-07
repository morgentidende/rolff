-- Existing timezones are deliberately retained as fixed choices. New clients explicitly
-- initialize automatic mode, and one chosen device controls subsequent zone syncs.
alter table public.receive_settings
  add column timezone_mode text not null default 'fixed' check (timezone_mode in ('auto','fixed')),
  add column timezone_device_id uuid,
  add column timezone_revision bigint not null default 1 check (timezone_revision > 0),
  add column timezone_synced_at timestamptz,
  add constraint receive_timezone_controller check ((timezone_mode = 'fixed' and timezone_device_id is null) or (timezone_mode = 'auto' and timezone_device_id is not null));

-- Old clients must not bypass atomic saves or take control of automatic mode.
revoke insert, update, delete on public.receive_settings, public.receive_windows from authenticated, anon;
revoke select on public.receive_settings from authenticated;
grant select(user_id,timezone,enabled,timezone_mode,timezone_revision,timezone_synced_at) on public.receive_settings to authenticated;

create function public._receive_timezone_result(p_uid uuid, p_device uuid) returns jsonb
language plpgsql stable set search_path = pg_catalog, public as $$
declare s public.receive_settings; w jsonb;
begin
  select * into s from public.receive_settings where user_id = p_uid;
  if not found then return jsonb_build_object('configured',false,'timezone',null,'mode','auto','revision',0,'enabled',false,'windows','[]'::jsonb,'is_controller',false,'synced_at',null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'start_minute',start_minute,'end_minute',end_minute) order by weekday,start_minute,end_minute),'[]'::jsonb) into w from public.receive_windows where user_id=p_uid;
  return jsonb_build_object('configured',true,'timezone',s.timezone,'mode',s.timezone_mode,'revision',s.timezone_revision,'enabled',s.enabled,'windows',w,'is_controller',coalesce(s.timezone_mode='auto' and s.timezone_device_id=p_device,false),'synced_at',s.timezone_synced_at);
end $$;
revoke all on function public._receive_timezone_result(uuid,uuid) from public,anon,authenticated;

create function public.get_my_receive_settings(p_device_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  return public._receive_timezone_result(auth.uid(),p_device_id);
end $$;
revoke all on function public.get_my_receive_settings(uuid) from public,anon;
grant execute on function public.get_my_receive_settings(uuid) to authenticated;

create function public.save_my_receive_settings(p_enabled boolean,p_windows jsonb,p_mode text,p_timezone text,p_device_id uuid,p_expected_revision bigint,p_take_over boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid:=auth.uid(); s public.receive_settings; had boolean; controller uuid; synced timestamptz; w jsonb; d int; a int; b int;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  -- Shared release locks are mutually compatible even for conversations with many
  -- recipients. Settings updates take one exclusive lock, including for missing rows.
  perform pg_advisory_xact_lock(hashtextextended('rolff:receive:'||me::text,0));
  select * into s from public.receive_settings where user_id=me for update; had:=found;
  if p_expected_revision is distinct from (case when had then s.timezone_revision else 0 end) then raise exception 'settings_conflict' using errcode='40001'; end if;
  if p_enabled is null or p_mode is null or p_mode not in ('auto','fixed') or p_take_over is null then raise exception 'invalid_settings' using errcode='22023'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) or not (p_timezone='UTC' or (position('/' in p_timezone)>0 and p_timezone !~ '^(posix|right)/') or (had and p_timezone=s.timezone)) then raise exception 'invalid_timezone' using errcode='22023'; end if;
  if jsonb_typeof(p_windows) is distinct from 'array' then raise exception 'invalid_windows' using errcode='22023'; end if;
  if jsonb_array_length(p_windows)>128 then raise exception 'invalid_windows' using errcode='22023'; end if;
  for w in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(w) is distinct from 'object' or jsonb_typeof(w->'weekday') is distinct from 'number' or jsonb_typeof(w->'start_minute') is distinct from 'number' or jsonb_typeof(w->'end_minute') is distinct from 'number' or (w->>'weekday') !~ '^[0-9]+$' or (w->>'start_minute') !~ '^[0-9]+$' or (w->>'end_minute') !~ '^[0-9]+$' then raise exception 'invalid_windows' using errcode='22023'; end if;
    begin d:=(w->>'weekday')::int; a:=(w->>'start_minute')::int; b:=(w->>'end_minute')::int; exception when numeric_value_out_of_range then raise exception 'invalid_windows' using errcode='22023'; end;
    if d not between 1 and 7 or a not between 0 and 1439 or b not between 0 and 1440 or a=b then raise exception 'invalid_windows' using errcode='22023'; end if;
  end loop;
  if p_mode='auto' then
    if had and s.timezone_mode='auto' and s.timezone_device_id is distinct from p_device_id and not p_take_over then
      -- Another device may edit the windows without silently taking over the zone.
      if p_timezone is distinct from s.timezone then raise exception 'timezone_control_required' using errcode='42501'; end if;
      controller:=s.timezone_device_id; synced:=s.timezone_synced_at;
    else
      if p_device_id is null then raise exception 'device_required' using errcode='22023'; end if;
      controller:=p_device_id; synced:=clock_timestamp();
    end if;
  else controller:=null; synced:=null;
  end if;
  insert into public.receive_settings(user_id,timezone,enabled,timezone_mode,timezone_device_id,timezone_revision,timezone_synced_at)
    values(me,p_timezone,p_enabled,p_mode,controller,case when had then s.timezone_revision+1 else 1 end,synced)
    on conflict(user_id) do update set timezone=excluded.timezone,enabled=excluded.enabled,timezone_mode=excluded.timezone_mode,timezone_device_id=excluded.timezone_device_id,timezone_revision=excluded.timezone_revision,timezone_synced_at=excluded.timezone_synced_at;
  delete from public.receive_windows where user_id=me;
  insert into public.receive_windows(user_id,weekday,start_minute,end_minute)
    select me,(value->>'weekday')::int,(value->>'start_minute')::int,(value->>'end_minute')::int from jsonb_array_elements(p_windows);
  return public._receive_timezone_result(me,p_device_id);
end $$;
revoke all on function public.save_my_receive_settings(boolean,jsonb,text,text,uuid,bigint,boolean) from public,anon;
grant execute on function public.save_my_receive_settings(boolean,jsonb,text,text,uuid,bigint,boolean) to authenticated;

create function public.sync_my_receive_timezone(p_timezone text,p_device_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid:=auth.uid(); s public.receive_settings;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rolff:receive:'||me::text,0));
  select * into s from public.receive_settings where user_id=me for update;
  if not found then raise exception 'receive_settings_missing' using errcode='22023'; end if;
  if s.timezone_mode<>'auto' or p_device_id is null or s.timezone_device_id is distinct from p_device_id then raise exception 'timezone_not_controller' using errcode='42501'; end if;
  if p_expected_revision is distinct from s.timezone_revision then raise exception 'settings_conflict' using errcode='40001'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) or not (p_timezone='UTC' or (position('/' in p_timezone)>0 and p_timezone !~ '^(posix|right)/') or p_timezone=s.timezone) then raise exception 'invalid_timezone' using errcode='22023'; end if;
  update public.receive_settings set timezone=p_timezone,timezone_revision=timezone_revision+1,timezone_synced_at=clock_timestamp() where user_id=me;
  return public._receive_timezone_result(me,p_device_id);
end $$;
revoke all on function public.sync_my_receive_timezone(text,uuid,bigint) from public,anon;
grant execute on function public.sync_my_receive_timezone(text,uuid,bigint) to authenticated;

create or replace function public._release_for(uid uuid, force boolean)
returns int language plpgsql security definer set search_path = pg_catalog, public as $$
declare n int;
begin
  -- Normal multi-recipient releases must not queue shared locks behind waiting
  -- writers: two reverse-order recipient batches can otherwise form a cycle.
  -- Defer a contended recipient; the next normal send/read/scheduled release
  -- retries against the committed settings, without releasing outside a window.
  -- The explicit single-recipient 'Receive now' RPC may wait for that user.
  if force then
    perform pg_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0));
  elsif not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0)) then
    return 0;
  end if;
  if not force and not public.in_receive_window(uid) then return 0; end if;
  update public.message_deliveries set released_at = clock_timestamp() where recipient_id=uid and released_at is null;
  get diagnostics n=row_count;
  if n>0 then insert into public.notification_jobs(user_id) values(uid); end if;
  return n;
end $$;
