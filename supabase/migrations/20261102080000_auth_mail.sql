-- Rate limit for recovery / email-change mails. Stores only a SHA-256 hash of the address + kind + time.
create table if not exists public.auth_mail_log (
  id bigint generated always as identity primary key,
  email_hash text not null, kind text not null check (kind in ('recovery','email_change')),
  created_at timestamptz not null default now());
create index if not exists auth_mail_log_idx on public.auth_mail_log (email_hash, created_at);
alter table public.auth_mail_log enable row level security;
revoke all on public.auth_mail_log from anon, authenticated;
-- Returns true and logs if under the limit (3 per hour and 6 per day per address+kind). Service only.
create or replace function public.auth_mail_allow(p_hash text, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from auth_mail_log where created_at < now() - interval '2 days';
  if (select count(*) from auth_mail_log where email_hash = p_hash and kind = p_kind and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from auth_mail_log where email_hash = p_hash and kind = p_kind and created_at > now() - interval '1 day') >= 6
  then return false; end if;
  insert into auth_mail_log (email_hash, kind) values (p_hash, p_kind);
  return true;
end $$;
revoke all on function public.auth_mail_allow(text, text) from public, anon, authenticated;
grant all on public.auth_mail_log to service_role;
grant execute on function public.auth_mail_allow(text, text) to service_role;
