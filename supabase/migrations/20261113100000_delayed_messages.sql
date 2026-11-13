-- Optional 30-second delayed send, per user per conversation (off by default).
-- A held message is visible only to the sender until deliver_after, then follows
-- the existing receive-window release and notification path. No read or delivery
-- receipts are added. Recipients never see a message still inside the delay.

create table public.conversation_delayed_send (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_delayed_send enable row level security;
revoke all on public.conversation_delayed_send from public, anon, authenticated;
grant all on public.conversation_delayed_send to service_role;

create function public.set_delayed_send(conv uuid, p_enabled boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); mem public.memberships;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into mem from public.memberships where conversation_id=conv and user_id=me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  if mem.role = 'reader' then raise exception 'read_only' using errcode='42501'; end if;
  insert into public.conversation_delayed_send(user_id, conversation_id, enabled)
    values (me, conv, p_enabled)
    on conflict (user_id, conversation_id)
    do update set enabled = excluded.enabled, updated_at = clock_timestamp();
  return p_enabled;
end $$;
revoke all on function public.set_delayed_send(uuid, boolean) from public, anon;
grant execute on function public.set_delayed_send(uuid, boolean) to authenticated;

create function public.delayed_send_enabled(conv uuid)
returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(conv, me) then raise exception 'not_member' using errcode='42501'; end if;
  return coalesce((
    select s.enabled from public.conversation_delayed_send s
    where s.user_id=me and s.conversation_id=conv
  ), false);
end $$;
revoke all on function public.delayed_send_enabled(uuid) from public, anon;
grant execute on function public.delayed_send_enabled(uuid) to authenticated;

alter table public.messages
  add column deliver_after timestamptz,
  add column edited_at timestamptz;

create index messages_deliver_after_due
  on public.messages(deliver_after)
  where deliver_after is not null;

-- When the per-conversation preference is on, hold the message for 30 seconds.
create function public._delayed_until(p_sender uuid, conv uuid)
returns timestamptz
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when exists (
    select 1 from public.conversation_delayed_send s
    where s.user_id=p_sender and s.conversation_id=conv and s.enabled
  ) then clock_timestamp() + interval '30 seconds' else null end
$$;
revoke all on function public._delayed_until(uuid, uuid) from public, anon, authenticated;

-- Still inside the sender's undo window: delay not yet due, and nothing released.
create function public._delayed_pending(mid uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.messages m
    where m.id=mid
      and m.deliver_after is not null
      and m.deliver_after > clock_timestamp()
      and not exists (
        select 1 from public.message_deliveries d
        where d.message_id=m.id and d.released_at is not null
      )
  )
$$;
revoke all on function public._delayed_pending(uuid) from public, anon, authenticated;

-- Due deliveries only: a still-counting delayed message must not be released,
-- even by "Receive now", and must not appear in the recipient's pending count.
create or replace function public._release_for(uid uuid, force boolean)
returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare n int;
begin
  if force then
    perform pg_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0));
  elsif not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0)) then
    return 0;
  end if;
  if not force and not public.in_receive_window(uid) then return 0; end if;
  update public.message_deliveries d set released_at = clock_timestamp()
   where d.recipient_id=uid and d.released_at is null
     and exists (
       select 1 from public.messages m
       where m.id=d.message_id
         and (m.deliver_after is null or m.deliver_after <= clock_timestamp())
     );
  get diagnostics n=row_count;
  if n>0 then insert into public.notification_jobs(user_id) values(uid); end if;
  return n;
end $$;

create or replace function public.my_pending_count()
returns int language sql stable security definer set search_path = pg_catalog, public as $$
  select count(*)::int
  from public.message_deliveries d
  join public.messages m on m.id=d.message_id
  where d.recipient_id = auth.uid() and d.released_at is null
    and (m.deliver_after is null or m.deliver_after <= clock_timestamp())
$$;

create or replace function public.commit_message(p_approval uuid, p_sender uuid, conv uuid, p_body text, p_key text)
returns table(message_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare existing uuid; h text := encode(digest(p_body,'sha256'),'hex'); mid uuid; ok uuid;
begin
  select id into existing from messages where sender_id=p_sender and idempotency_key=p_key;
  if found then return query select existing, true; return; end if;
  if not exists(select 1 from memberships where conversation_id=conv and user_id=p_sender and left_at is null and role <> 'reader')
    then raise exception 'not_member' using errcode='42501'; end if;
  update moderation_approvals set consumed_at = clock_timestamp()
   where id=p_approval and sender_id=p_sender and conversation_id=conv and body_hash=h
     and consumed_at is null and expires_at > now()
  returning id into ok;
  if ok is null then raise exception 'approval_invalid' using errcode='P0001'; end if;
  insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,deliver_after)
    values (conv,p_sender,p_body,h,p_key, public._delayed_until(p_sender, conv))
    returning id into mid;
  insert into message_deliveries(message_id,recipient_id)
    select mid, m.user_id from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  perform _release_for(m.user_id, false) from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  return query select mid, false;
end $$;

create or replace function public.commit_attachment_message(p_approval uuid, p_sender uuid, conv uuid, p_body text, p_key text,
  p_mime text, p_name text, p_alt text, p_pages int, p_data bytea)
returns table(message_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare existing uuid; h text; mid uuid; ok uuid;
begin
  select id into existing from messages where sender_id=p_sender and idempotency_key=p_key;
  if found then return query select existing, true; return; end if;
  if not exists(select 1 from memberships where conversation_id=conv and user_id=p_sender and left_at is null and role <> 'reader')
    then raise exception 'not_member' using errcode='42501'; end if;
  if _effective_plan(p_sender) <> 'text_attachments' then raise exception 'plan_required' using errcode='42501'; end if;
  if (select count(*) from messages m join message_attachments a on a.message_id = m.id
      where m.sender_id = p_sender and m.created_at > now() - interval '24 hours') >= 20 then raise exception 'rate_limited' using errcode='P0001'; end if;
  h := encode(digest(p_body || E'\n' || encode(digest(p_data,'sha256'),'hex'),'sha256'),'hex');
  update moderation_approvals set consumed_at = clock_timestamp()
   where id=p_approval and sender_id=p_sender and conversation_id=conv and body_hash=h and consumed_at is null and expires_at > now()
  returning id into ok;
  if ok is null then raise exception 'approval_invalid' using errcode='P0001'; end if;
  insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key,deliver_after)
    values (conv,p_sender,p_body,h,p_key, public._delayed_until(p_sender, conv))
    returning id into mid;
  insert into message_attachments(message_id,mime,name,alt,size,pages,data) values (mid,p_mime,p_name,nullif(p_alt,''),octet_length(p_data),p_pages,p_data);
  insert into message_deliveries(message_id,recipient_id)
    select mid, m.user_id from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  perform _release_for(m.user_id, false) from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  return query select mid, false;
end $$;

-- Edits of delayed messages must also respect the plan length.
drop trigger if exists messages_plan_length on public.messages;
create trigger messages_plan_length before insert or update of body on public.messages
  for each row execute function public.enforce_message_plan_length();

drop function public.get_messages_v2(uuid);
create function public.get_messages_v2(conv uuid)
returns table(id uuid,sender_id uuid,sender_name text,body text,created_at timestamptz,mine boolean,att_mime text,att_name text,att_alt text,att_pages int,sender_email text,reply_to_id uuid,reply_body text,has_reply boolean,deliver_after timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  return query with visible as materialized (select * from get_messages(conv))
    select g.id,g.sender_id,g.sender_name,g.body,g.created_at,g.mine,g.att_mime,g.att_name,g.att_alt,g.att_pages,
      u.email::text, r.target_id, q.body, r.message_id is not null,
      case when g.mine and m.deliver_after is not null and m.deliver_after > clock_timestamp()
            and not exists (select 1 from message_deliveries d where d.message_id=g.id and d.released_at is not null)
           then m.deliver_after else null end
    from visible g
      join messages m on m.id=g.id
      left join auth.users u on u.id=g.sender_id
      left join message_replies r on r.message_id=g.id left join messages q on q.id=r.target_id and q.conversation_id=conv
        and q.created_at >= _retention_cutoff(auth.uid())
        and exists(select 1 from memberships mem where mem.user_id=auth.uid() and mem.conversation_id=conv and mem.left_at is null and q.created_at>=mem.joined_at)
        and (q.sender_id=auth.uid() or exists(select 1 from message_deliveries d where d.message_id=q.id and d.recipient_id=auth.uid() and d.released_at is not null))
    order by g.created_at,g.id;
end $$;
revoke execute on function public.get_messages_v2(uuid) from public,anon;
grant execute on function public.get_messages_v2(uuid) to authenticated;

-- Live client uses get_messages_v3 (thumbs + same visibility as v2).
-- Pass deliver_after through so the sender can see a held message's countdown.
drop function if exists public.get_messages_v3(uuid);
create function public.get_messages_v3(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean,
  att_mime text, att_name text, att_alt text, att_pages int, sender_email text,
  reply_to_id uuid, reply_body text, has_reply boolean, thumb_count int, i_thumbed boolean, deliver_after timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query with visible as materialized (select * from get_messages_v2(conv))
    select g.id, g.sender_id, g.sender_name, g.body, g.created_at, g.mine, g.att_mime, g.att_name, g.att_alt, g.att_pages,
      g.sender_email, g.reply_to_id, g.reply_body, g.has_reply,
      (select count(*)::int from message_reactions r where r.message_id = g.id),
      exists(select 1 from message_reactions r where r.message_id = g.id and r.user_id = auth.uid()),
      g.deliver_after
    from visible g
    order by g.created_at, g.id;
end $$;
revoke execute on function public.get_messages_v3(uuid) from public, anon;
grant execute on function public.get_messages_v3(uuid) to authenticated;

-- Sender ends the delay now (tap the countdown, or the 30 s timer elapsed).
-- Already-moderated text is not changed. Delivery uses the normal release path
-- (receive windows + notification job only if something is actually released).
create function public.release_delayed_message(p_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into m from public.messages where id=p_id and sender_id=me for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if m.deliver_after is null
     or exists (select 1 from public.message_deliveries d where d.message_id=m.id and d.released_at is not null) then
    return false;
  end if;
  if m.deliver_after > clock_timestamp() then
    update public.messages set deliver_after = clock_timestamp() where id=m.id;
  end if;
  perform public._release_for(d.recipient_id, false)
    from public.message_deliveries d where d.message_id=m.id and d.released_at is null;
  return true;
end $$;
revoke all on function public.release_delayed_message(uuid) from public, anon;
grant execute on function public.release_delayed_message(uuid) to authenticated;

create function public.cancel_delayed_message(p_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into m from public.messages where id=p_id and sender_id=me for update;
  if not found or not public._delayed_pending(p_id) then
    raise exception 'no_longer_pending' using errcode='P0001';
  end if;
  delete from public.messages where id=m.id;
end $$;
revoke all on function public.cancel_delayed_message(uuid) from public, anon;
grant execute on function public.cancel_delayed_message(uuid) to authenticated;

-- Service-role only: consume a fresh moderation approval and replace the held text.
-- Restarts the 30-second window so the sender can review the edited wording.
create function public.update_delayed_message(p_approval uuid, p_sender uuid, p_id uuid, p_body text)
returns table(message_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare m messages; h text := encode(digest(p_body,'sha256'),'hex'); ok uuid;
begin
  if char_length(p_body) < 1 or char_length(p_body) > 480 then raise exception 'length' using errcode='22001'; end if;
  select * into m from messages where id=p_id and sender_id=p_sender for update;
  if not found or not public._delayed_pending(p_id) then raise exception 'no_longer_pending' using errcode='P0001'; end if;
  if not exists(select 1 from memberships where conversation_id=m.conversation_id and user_id=p_sender and left_at is null and role <> 'reader')
    then raise exception 'not_member' using errcode='42501'; end if;
  update moderation_approvals set consumed_at = clock_timestamp()
   where id=p_approval and sender_id=p_sender and conversation_id=m.conversation_id and body_hash=h
     and consumed_at is null and expires_at > now()
  returning id into ok;
  if ok is null then raise exception 'approval_invalid' using errcode='P0001'; end if;
  update messages
     set body=p_body, body_hash=h, edited_at=clock_timestamp(),
         deliver_after=clock_timestamp() + interval '30 seconds'
   where id=m.id;
  return query select m.id;
end $$;
revoke all on function public.update_delayed_message(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.update_delayed_message(uuid,uuid,uuid,text) to service_role;

-- A still-held delayed message is not a reply target (it has not been sent yet).
create or replace function public.assert_reply_target(p_sender uuid, conv uuid, p_reply uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reply is null then return; end if;
  perform m.id from messages m join memberships mem on mem.conversation_id=m.conversation_id
    where m.id=p_reply and m.conversation_id=conv and mem.user_id=p_sender and mem.left_at is null
      and mem.role <> 'reader' and m.created_at >= mem.joined_at and m.created_at >= _retention_cutoff(p_sender)
      and not public._delayed_pending(m.id)
      and (m.sender_id=p_sender or exists(select 1 from message_deliveries d where d.message_id=m.id and d.recipient_id=p_sender and d.released_at is not null))
    for key share of m;
  if not found then raise exception 'invalid_reply' using errcode='42501'; end if;
end $$;
