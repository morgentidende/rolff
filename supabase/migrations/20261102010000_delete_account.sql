-- GDPR: account deletion (art. 17), inactivity deletion, privacy settings.
-- Counterpart handling (Nicolai 2026-11-02, Rolff is an evidence app): deletion removes ONLY the
-- deleting party's own data. Every message the user sent stays in the conversation for the remaining
-- members, unchanged (sender shown as "Slettet bruger"); undelivered messages are still delivered
-- per the counterpart's receive window. Conversations with no other active member are deleted.

alter table public.messages alter column sender_id drop not null;
alter table public.messages drop constraint messages_sender_id_fkey,
  add constraint messages_sender_id_fkey foreign key (sender_id) references auth.users(id) on delete set null;
alter table public.conversations alter column created_by drop not null;
alter table public.conversations drop constraint conversations_created_by_fkey,
  add constraint conversations_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.invitations alter column created_by drop not null;
alter table public.invitations drop constraint invitations_created_by_fkey,
  add constraint invitations_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.invitations drop constraint invitations_accepted_by_fkey,
  add constraint invitations_accepted_by_fkey foreign key (accepted_by) references auth.users(id) on delete set null;
alter table public.invitations drop constraint invitations_declined_by_fkey,
  add constraint invitations_declined_by_fkey foreign key (declined_by) references auth.users(id) on delete set null;

create table public.user_privacy (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  inactivity_delete boolean not null default true,
  inactivity_days int not null default 90 check (inactivity_days between 30 and 90),
  warned_at timestamptz,
  cloud_sync boolean not null default false,
  retention text not null default '1y' check (retention in ('1y','5y','unlimited')),
  updated_at timestamptz not null default now()
);
alter table public.user_privacy enable row level security;
revoke all on public.user_privacy from public, anon, authenticated;
grant all on public.user_privacy to service_role;

-- Called by the client on app start; also cancels a pending inactivity warning.
create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  insert into user_privacy(user_id) values (auth.uid())
  on conflict (user_id) do update set last_seen_at = now(), warned_at = null;
$$;

create or replace function public.get_my_privacy()
returns table(inactivity_delete boolean, inactivity_days int, cloud_sync boolean, retention text)
language sql security definer set search_path = public as $$
  insert into user_privacy(user_id) values (auth.uid()) on conflict do nothing;
  select inactivity_delete, inactivity_days, cloud_sync, retention from user_privacy where user_id = auth.uid();
$$;

create or replace function public.set_my_privacy(p_inactivity_delete boolean, p_inactivity_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  insert into user_privacy(user_id, inactivity_delete, inactivity_days) values (auth.uid(), p_inactivity_delete, p_inactivity_days)
  on conflict (user_id) do update set inactivity_delete = excluded.inactivity_delete, inactivity_days = excluded.inactivity_days, updated_at = now();
end $$;

-- Service only: remove everything that must not survive the account. auth.users row is deleted
-- by the caller (Edge Function via Admin API), which cascades the rest.
create or replace function public.purge_user_content(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- conversations without another active member disappear (cascades messages, invitations, ...)
  delete from conversations c where exists (select 1 from memberships x where x.conversation_id = c.id and x.user_id = p_uid)
    and not exists (select 1 from memberships x where x.conversation_id = c.id and x.user_id <> p_uid and x.left_at is null);
  -- open invitations created by the user disappear
  delete from invitations where created_by = p_uid and accepted_at is null;
end $$;

-- Service only: inactivity sweep. Returns users to warn (marks them) and users due for deletion.
create or replace function public.inactivity_sweep(p_grace interval default interval '14 days')
returns table(user_id uuid, email text, action text)
language plpgsql security definer set search_path = public as $$
begin
  insert into user_privacy(user_id, last_seen_at)
    select u.id, coalesce(u.last_sign_in_at, u.created_at, now()) from auth.users u
    on conflict do nothing;
  return query
    select p.user_id, u.email::text, 'delete'::text from user_privacy p join auth.users u on u.id = p.user_id
    where p.inactivity_delete and p.warned_at is not null and p.warned_at < now() - p_grace
      and p.last_seen_at < p.warned_at;
  return query
    with w as (update user_privacy p set warned_at = now()
      where p.inactivity_delete and p.warned_at is null and p.last_seen_at < now() - make_interval(days => p.inactivity_days)
      returning p.user_id)
    select w.user_id, u.email::text, 'warn'::text from w join auth.users u on u.id = w.user_id;
end $$;

revoke execute on function public.purge_user_content(uuid), public.inactivity_sweep(interval) from public, anon, authenticated;
grant execute on function public.purge_user_content(uuid), public.inactivity_sweep(interval) to service_role;
revoke execute on function public.touch_seen(), public.get_my_privacy(), public.set_my_privacy(boolean,int) from public, anon;
grant execute on function public.touch_seen(), public.get_my_privacy(), public.set_my_privacy(boolean,int) to authenticated;

-- Deleted senders are shown as "Slettet bruger".
create or replace function public.get_messages(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships;
begin
  select * into mem from memberships where conversation_id=conv and user_id=me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  perform _release_for(me, false);
  return query
    select msg.id, msg.sender_id, case when msg.sender_id is null then 'Slettet bruger' else _label_for(me, msg.sender_id) end,
      msg.body, msg.created_at, coalesce(msg.sender_id = me, false)
    from messages msg
    where msg.conversation_id = conv and msg.created_at >= mem.joined_at
      and (msg.sender_id = me or exists (select 1 from message_deliveries d
             where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
    order by msg.created_at asc limit 500;
end $$;
