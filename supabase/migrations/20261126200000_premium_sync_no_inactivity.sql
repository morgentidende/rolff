-- Sky-synk is Premium-only. Automatic account deletion for inactivity is removed.
--
-- Downgrade / "fra" semantics: when a user is no longer on Premium (pending downgrade or
-- cancellation takes effect, or an immediate test downgrade), cloud_sync is set to false.
-- There is no sync_keys table yet. In the web test version the server remains the only
-- lasting copy, so turning sync off does not delete messages already on the server (same
-- as today's "fra" behaviour in the web demo). When the mobile app with per-owner sync
-- copies exists, "fra" means: the server keeps a message only until it is delivered, and
-- that user's sync copy and sync key are deleted immediately. The other party's copy is
-- never touched.
--
-- inactivity-sweep Edge Function no longer warns or deletes accounts. The existing pg_cron
-- job that HTTP-invokes that function is left in place because it also runs retention_sweep()
-- daily. Direct SQL cron jobs that only call inactivity_sweep() are unscheduled when pg_cron
-- is available.

-- 1) Neutralize inactivity deletion
alter table public.user_privacy alter column inactivity_delete set default false;

update public.user_privacy
   set inactivity_delete = false, warned_at = null, updated_at = now()
 where inactivity_delete or warned_at is not null;

create or replace function public.inactivity_sweep(p_grace interval default interval '14 days')
returns table(user_id uuid, email text, action text)
language plpgsql security definer set search_path = public as $$
begin
  -- Account inactivity deletion has been removed. Kept as a no-op so an old cron or
  -- service caller cannot delete accounts. p_grace is ignored.
  return;
end $$;

create or replace function public.set_my_privacy(p_inactivity_delete boolean, p_inactivity_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  -- Accepted so older clients do not error, but the setting cannot be turned on.
  insert into user_privacy(user_id, inactivity_delete, inactivity_days)
    values (auth.uid(), false, 90)
  on conflict (user_id) do update set inactivity_delete = false, warned_at = null, updated_at = now();
end $$;

create or replace function public.get_my_privacy()
returns table(inactivity_delete boolean, inactivity_days int, cloud_sync boolean, retention text)
language sql security definer set search_path = public as $$
  insert into user_privacy(user_id) values (auth.uid()) on conflict do nothing;
  select inactivity_delete, inactivity_days, cloud_sync, retention from user_privacy where user_id = auth.uid();
$$;

-- 2) Premium-only cloud sync
create or replace function public._turn_off_cloud_sync(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update user_privacy set cloud_sync = false, updated_at = now()
    where user_id = uid and cloud_sync is true;
end $$;
revoke execute on function public._turn_off_cloud_sync(uuid) from public, anon, authenticated;
grant execute on function public._turn_off_cloud_sync(uuid) to service_role;

-- Apply a due pending plan, then turn sync off when the resulting plan is not Premium.
create or replace function public._effective_plan(uid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p user_plans;
begin
  select * into p from user_plans where user_id = uid for update;
  if not found then return 'text'; end if;
  if p.period_end <= now() then
    update user_plans set plan = coalesce(pending_plan, plan), pending_plan = null,
      period_start = now(), period_end = now() + interval '1 month', updated_at = now()
      where user_id = uid returning * into p;
  end if;
  if p.plan is distinct from 'text_attachments' then
    perform _turn_off_cloud_sync(uid);
  end if;
  return p.plan;
end $$;
revoke execute on function public._effective_plan(uuid) from public, anon, authenticated;
grant execute on function public._effective_plan(uuid) to service_role;

create or replace function public.set_my_data_prefs(p_cloud_sync boolean, p_retention text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_retention not in ('1y','5y','unlimited') or p_cloud_sync is null then raise exception 'bad_input' using errcode='22023'; end if;
  if p_cloud_sync and _effective_plan(auth.uid()) is distinct from 'text_attachments' then
    raise exception 'plan_required' using errcode='42501';
  end if;
  insert into user_privacy(user_id, cloud_sync, retention) values (auth.uid(), p_cloud_sync, p_retention)
  on conflict (user_id) do update set cloud_sync = excluded.cloud_sync, retention = excluded.retention, updated_at = now();
end $$;
revoke execute on function public.set_my_data_prefs(boolean,text) from public, anon;
grant execute on function public.set_my_data_prefs(boolean,text) to authenticated;

-- Defense in depth: even service_role cannot store cloud_sync=true without Premium.
-- Reads the would-be effective plan without writing, to avoid trigger recursion.
create or replace function public._guard_cloud_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl text;
begin
  if new.cloud_sync is not true then return new; end if;
  select case when period_end <= now() then coalesce(pending_plan, plan) else plan end
    into pl from user_plans where user_id = new.user_id;
  if pl is distinct from 'text_attachments' then
    raise exception 'plan_required' using errcode='42501';
  end if;
  return new;
end $$;

drop trigger if exists user_privacy_cloud_sync_premium on public.user_privacy;
create trigger user_privacy_cloud_sync_premium
  before insert or update of cloud_sync on public.user_privacy
  for each row execute function public._guard_cloud_sync();

-- Immediate plan changes (set_my_plan_test with p_now, etc.) also drop sync.
create or replace function public._user_plans_sync_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan is distinct from 'text_attachments' then
    perform _turn_off_cloud_sync(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists user_plans_turn_off_sync on public.user_plans;
create trigger user_plans_turn_off_sync
  after insert or update of plan on public.user_plans
  for each row execute function public._user_plans_sync_guard();

-- Existing non-Premium rows with sync left on (should not happen in practice).
update public.user_privacy up set cloud_sync = false, updated_at = now()
 where up.cloud_sync
   and not exists (
     select 1 from user_plans p
      where p.user_id = up.user_id
        and (case when p.period_end <= now() then coalesce(p.pending_plan, p.plan) else p.plan end) = 'text_attachments'
   );

-- 3) Unschedule direct SQL inactivity_sweep cron jobs when pg_cron is present.
-- Do not unschedule HTTP jobs that call the inactivity-sweep Edge Function (retention).
do $cron$
begin
  if to_regprocedure('cron.unschedule(bigint)') is not null then
    perform cron.unschedule(j.jobid)
      from cron.job j
     where j.command ~* 'inactivity_sweep\s*\('
       and j.command !~* 'http'
       and j.command !~* 'retention_sweep';
  end if;
exception when undefined_table or undefined_function or invalid_schema_name then
  null;
end
$cron$;
