-- profiles.locale already exists (da|en, default 'da') but was never written by the app.
-- Adds a setter for the signed-in user and service-role lookups used by outbound mail
-- (password reset, inactivity warning, export receipt, e-mail-change notices).
create or replace function public.set_my_locale(p_locale text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); loc text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_locale is null or p_locale not in ('da','en') then raise exception 'bad_input' using errcode='22023'; end if;
  update profiles set locale = p_locale where user_id = me returning locale into loc;
  if loc is null then
    insert into profiles(user_id, display_name, locale)
      values (me, 'Bruger', p_locale)
      on conflict (user_id) do update set locale = excluded.locale
      returning locale into loc;
  end if;
  return loc;
end $$;
revoke execute on function public.set_my_locale(text) from public, anon;
grant execute on function public.set_my_locale(text) to authenticated;

create or replace function public.locale_of(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select locale from profiles where user_id = p_uid), 'da')
$$;
revoke execute on function public.locale_of(uuid) from public, anon, authenticated;
grant execute on function public.locale_of(uuid) to service_role;

create or replace function public.locale_for_email(p_email text)
returns text language sql stable security definer set search_path = public, auth as $$
  select p.locale
  from auth.users u
  join public.profiles p on p.user_id = u.id
  where lower(u.email) = lower(p_email)
  limit 1
$$;
revoke execute on function public.locale_for_email(text) from public, anon, authenticated;
grant execute on function public.locale_for_email(text) to service_role;
