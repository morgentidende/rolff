-- Remove the self-chosen public display name (decision 2026-11-09, Nicolai): users could pick
-- provocative names. Others now ALWAYS see the user's e-mail, unless the viewer has set their own
-- PRIVATE nickname (contact_aliases), which only the viewer sees. Private aliases are untouched.

-- 1) Stop exposing it: every label shown to others (conversation list, chat/bubbles, members,
--    invitations, approvals, court export, invitation e-mails) goes through _public_label/_label_for.
create or replace function public._public_label(target uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select email from auth.users where id = target), '?')
$$;
revoke execute on function public._public_label(uuid) from public, anon, authenticated;

-- 2) Prevent writes: drop the RPCs and forbid any value via a constraint (also blocks direct
--    table updates through the profiles_self_update policy).
drop function if exists public.set_my_public_name(text);
drop function if exists public.get_my_public_name();

-- 3) Clear existing self-chosen names, then lock the column to NULL.
update public.profiles set public_name = null where public_name is not null;
alter table public.profiles drop constraint if exists profiles_public_name_removed;
alter table public.profiles add constraint profiles_public_name_removed check (public_name is null);
comment on column public.profiles.public_name is 'Removed 2026-11-09: always NULL. Others see the e-mail or their own private alias.';
