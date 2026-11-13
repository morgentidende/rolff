-- Fixed 👍 reaction on a message. This is not a text message: it is never moderated,
-- cannot carry text, and is not a delivery or read receipt. Only 👍 is allowed.
-- Access follows the same pattern as messages: RLS on, no client table grants,
-- read via get_messages_v3, write via toggle_message_thumb (membership + visibility).
create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null default '👍' check (emoji = '👍'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id)
);
create index message_reactions_user_idx on public.message_reactions(user_id);
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from public, anon, authenticated;
grant all on public.message_reactions to service_role;

-- Toggle the caller's 👍 on a visible message. Adding is refused for readers and
-- when another active member has blocked the conversation (same as sending).
-- Removing one's own 👍 stays allowed for any active member, including after a block.
create function public.toggle_message_thumb(p_message uuid)
returns table(message_id uuid, i_thumbed boolean, thumb_count int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  conv uuid;
  mem memberships;
  existed boolean;
begin
  if me is null then raise exception 'not_member' using errcode='42501'; end if;
  select m.conversation_id into conv from messages m where m.id = p_message;
  if conv is null then raise exception 'invalid_message' using errcode='42501'; end if;
  select * into mem from memberships where conversation_id = conv and user_id = me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  if not exists (
    select 1 from messages m
    where m.id = p_message and m.conversation_id = conv
      and m.created_at >= mem.joined_at and m.created_at >= _retention_cutoff(me)
      and (m.sender_id = me or exists (
        select 1 from message_deliveries d
        where d.message_id = m.id and d.recipient_id = me and d.released_at is not null))
  ) then raise exception 'invalid_message' using errcode='42501'; end if;

  select exists(select 1 from message_reactions r where r.message_id = p_message and r.user_id = me) into existed;
  if existed then
    delete from message_reactions r where r.message_id = p_message and r.user_id = me;
  else
    if mem.role = 'reader' then raise exception 'read_only' using errcode='42501'; end if;
    if exists (
      select 1 from conversation_blocks b
        join memberships bm on bm.conversation_id = b.conversation_id and bm.user_id = b.user_id and bm.left_at is null
      where b.conversation_id = conv and b.user_id is distinct from me
    ) then raise exception 'cannot_deliver' using errcode='42501'; end if;
    insert into message_reactions(message_id, user_id, emoji) values (p_message, me, '👍');
  end if;

  return query
    select p_message,
      exists(select 1 from message_reactions r where r.message_id = p_message and r.user_id = me),
      (select count(*)::int from message_reactions r where r.message_id = p_message);
end $$;
revoke execute on function public.toggle_message_thumb(uuid) from public, anon;
grant execute on function public.toggle_message_thumb(uuid) to authenticated;

-- Additive: same visibility as get_messages_v2, plus thumb_count / i_thumbed.
create function public.get_messages_v3(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean,
  att_mime text, att_name text, att_alt text, att_pages int, sender_email text,
  reply_to_id uuid, reply_body text, has_reply boolean, thumb_count int, i_thumbed boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query with visible as materialized (select * from get_messages_v2(conv))
    select g.id, g.sender_id, g.sender_name, g.body, g.created_at, g.mine, g.att_mime, g.att_name, g.att_alt, g.att_pages,
      g.sender_email, g.reply_to_id, g.reply_body, g.has_reply,
      (select count(*)::int from message_reactions r where r.message_id = g.id),
      exists(select 1 from message_reactions r where r.message_id = g.id and r.user_id = auth.uid())
    from visible g
    order by g.created_at, g.id;
end $$;
revoke execute on function public.get_messages_v3(uuid) from public, anon;
grant execute on function public.get_messages_v3(uuid) to authenticated;

-- Official transcript: add thumb_count. Same visibility rules as before.
drop function public.get_export_messages(uuid, uuid, timestamptz, timestamptz);
create function public.get_export_messages(p_uid uuid, conv uuid, p_from timestamptz, p_to timestamptz)
returns table(id uuid, sender_label text, sender_email text, sender_deleted boolean, mine boolean, body text, created_at timestamptz,
  att_mime text, att_name text, att_size int, att_pages int, att_sha256 text, reply_to_id uuid, has_reply boolean, reply_visible boolean,
  thumb_count int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare mem memberships; cut timestamptz;
begin
  select * into mem from memberships m where m.conversation_id=conv and m.user_id=p_uid and m.left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  cut := _retention_cutoff(p_uid);
  return query
    with visible as materialized (
      select msg.* from messages msg
      where msg.conversation_id=conv and msg.created_at >= mem.joined_at and msg.created_at >= cut
        and (p_from is null or msg.created_at >= p_from) and (p_to is null or msg.created_at <= p_to)
        and (msg.sender_id=p_uid or exists(select 1 from message_deliveries d where d.message_id=msg.id and d.recipient_id=p_uid and d.released_at is not null))
      order by msg.created_at, msg.id limit 5000)
    select v.id, case when v.sender_id is null then 'Slettet bruger' else _label_for(p_uid, v.sender_id) end, u.email::text, v.sender_id is null,
      coalesce(v.sender_id=p_uid,false), v.body, v.created_at, a.mime, a.name, a.size, a.pages,
      case when a.message_id is null then null else encode(digest(a.data,'sha256'),'hex') end,
      r.target_id, r.message_id is not null,
      (q.id is not null and q.created_at >= mem.joined_at and q.created_at >= cut
        and (q.sender_id=p_uid or exists(select 1 from message_deliveries d where d.message_id=q.id and d.recipient_id=p_uid and d.released_at is not null))),
      (select count(*)::int from message_reactions th where th.message_id = v.id)
    from visible v left join auth.users u on u.id=v.sender_id left join message_attachments a on a.message_id=v.id
      left join message_replies r on r.message_id=v.id left join messages q on q.id=r.target_id and q.conversation_id=conv
    order by v.created_at, v.id;
end $$;
revoke execute on function public.get_export_messages(uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.get_export_messages(uuid,uuid,timestamptz,timestamptz) to service_role;
