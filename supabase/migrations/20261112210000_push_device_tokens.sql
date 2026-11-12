-- Native push device tokens (FCM / APNs) for a future App Store / Google Play build.
-- NOT APPLIED. Nothing sends to these tokens yet; no secrets, no scheduling.
-- Web push subscriptions (endpoint + keys) live in push_subscriptions (PR54);
-- this table holds the different shape a native app gets: one opaque token
-- per device, with the platform it came from.
create table if not exists public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  provider text not null check (provider in ('fcm','apns')),
  token text not null check (char_length(token) between 20 and 4096 and token ~ '^[A-Za-z0-9:_.-]+$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '90 days'),
  constraint push_device_tokens_platform_provider check (platform = 'ios' or provider = 'fcm'),
  constraint push_device_tokens_token_unique unique (provider, token)
);
create index if not exists push_device_tokens_owner on public.push_device_tokens(user_id);
alter table public.push_device_tokens enable row level security;
-- No direct client access to tokens. Narrow owner RPCs only.
revoke all on public.push_device_tokens from public, anon, authenticated;
grant all on public.push_device_tokens to service_role;

-- Save (or renew) this device's token. A token owned by another account is never
-- silently reassigned. At most 8 live devices per account.
create or replace function public.save_my_device_token(p_platform text, p_provider text, p_token text, p_previous uuid default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); result uuid;
begin
  if me is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_platform is null or p_platform not in ('ios','android') or p_provider is null or p_provider not in ('fcm','apns')
     or (p_platform = 'android' and p_provider <> 'fcm')
     or p_token is null or char_length(p_token) not between 20 and 4096 or p_token !~ '^[A-Za-z0-9:_.-]+$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rolff:push:' || me::text, 0));
  if exists (select 1 from public.push_device_tokens where provider = p_provider and token = p_token and user_id <> me) then
    raise exception 'token_conflict' using errcode = '23505';
  end if;
  delete from public.push_device_tokens where user_id = me and (id = p_previous or (provider = p_provider and token = p_token) or expires_at <= clock_timestamp());
  if (select count(*) from public.push_device_tokens where user_id = me) >= 8 then raise exception 'device_limit' using errcode = '22023'; end if;
  insert into public.push_device_tokens(user_id, platform, provider, token) values (me, p_platform, p_provider, p_token) returning id into result;
  return result;
end $$;

create or replace function public.revoke_my_device_token(p_id uuid default null, p_all boolean default false)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  delete from public.push_device_tokens where user_id = me and (coalesce(p_all, false) or id = p_id);
end $$;

-- Anonymous device list for settings: no tokens leave the database.
create or replace function public.my_device_tokens()
returns table(id uuid, platform text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  return query select t.id, t.platform, t.created_at, t.expires_at from public.push_device_tokens t
    where t.user_id = auth.uid() and t.expires_at > clock_timestamp() order by t.created_at;
end $$;

revoke all on function public.save_my_device_token(text, text, text, uuid) from public, anon;
revoke all on function public.revoke_my_device_token(uuid, boolean) from public, anon;
revoke all on function public.my_device_tokens() from public, anon;
grant execute on function public.save_my_device_token(text, text, text, uuid) to authenticated, service_role;
grant execute on function public.revoke_my_device_token(uuid, boolean) to authenticated, service_role;
grant execute on function public.my_device_tokens() to authenticated, service_role;
