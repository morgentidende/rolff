-- Modtagetider must not be enabled without at least one window. Empty+enabled
-- previously meant new messages were never released automatically.
--
-- Existing broken rows (enabled=true, zero windows): repair by inserting the
-- same default the UI now offers — Mon–Sun 18:00–19:00 in the user's already
-- stored timezone — rather than flipping enabled off. They opted into receive
-- times; a predictable daily hour is closer to that intent than suddenly
-- releasing every message. Users can edit or turn the feature off afterwards.

insert into public.receive_windows(user_id, weekday, start_minute, end_minute)
select s.user_id, d.weekday, 18 * 60, 19 * 60
from public.receive_settings s
cross join generate_series(1, 7) as d(weekday)
where s.enabled
  and not exists (select 1 from public.receive_windows w where w.user_id = s.user_id);

create or replace function public.save_my_receive_settings(p_enabled boolean,p_windows jsonb,p_mode text,p_timezone text,p_device_id uuid,p_expected_revision bigint,p_take_over boolean default false) returns jsonb
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
  if p_enabled and jsonb_array_length(p_windows)=0 then raise exception 'windows_required' using errcode='22023'; end if;
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
