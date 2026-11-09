-- Email change notice (decision 2026-11-09, Nicolai). The e-mail is the name others see, so when a
-- change is CONFIRMED (auth.users.email actually changes) a small neutral system notice is posted in
-- each of the user's active conversations: "X har skiftet e-mail til Y". It is a conversation event,
-- not a message: no limits, no receive-time hold, no moderation, no Luna. Private aliases are keyed by
-- user id and stay intact. Each viewer sees X as their own private alias, else the OLD e-mail.
alter table public.conversation_events add column if not exists old_email text, add column if not exists new_email text;
alter table public.conversation_events drop constraint if exists conversation_events_kind_check;
alter table public.conversation_events add constraint conversation_events_kind_check check (kind in ('export', 'email_changed'));
alter table public.conversation_events drop constraint if exists conversation_events_email_changed_check;
alter table public.conversation_events add constraint conversation_events_email_changed_check
  check (kind <> 'email_changed' or (old_email is not null and new_email is not null));

create or replace function public._on_auth_email_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email is not null and new.email is not null and lower(old.email) is distinct from lower(new.email) then
    insert into conversation_events(conversation_id, actor_id, kind, old_email, new_email)
      select m.conversation_id, new.id, 'email_changed', old.email, new.email
      from memberships m where m.user_id = new.id and m.left_at is null;
  end if;
  return new;
end $$;
revoke execute on function public._on_auth_email_changed() from public, anon, authenticated;
drop trigger if exists on_auth_email_changed on auth.users;
create trigger on_auth_email_changed after update of email on auth.users
  for each row execute function public._on_auth_email_changed();

-- Return type changes (new_label), so drop + create. Same membership/joined_at/retention rules.
drop function if exists public.get_conversation_events(uuid);
create function public.get_conversation_events(conv uuid)
returns table(id uuid, kind text, actor_label text, mine boolean, created_at timestamptz, new_label text)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships;
begin
  select * into mem from memberships m where m.conversation_id=conv and m.user_id=me and m.left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  return query select ev.id, ev.kind,
      case when ev.kind = 'email_changed'
           then coalesce((select a.alias from contact_aliases a where a.owner_id = me and a.contact_user_id = ev.actor_id), ev.old_email)
           when ev.actor_id is null then 'Slettet bruger' else _label_for(me, ev.actor_id) end,
      coalesce(ev.actor_id=me,false), ev.created_at,
      case when ev.kind = 'email_changed' then ev.new_email end
    from conversation_events ev where ev.conversation_id=conv and ev.created_at >= mem.joined_at and ev.created_at >= _retention_cutoff(me)
    order by ev.created_at, ev.id limit 500;
end $$;
revoke execute on function public.get_conversation_events(uuid) from public, anon;
grant execute on function public.get_conversation_events(uuid) to authenticated;
