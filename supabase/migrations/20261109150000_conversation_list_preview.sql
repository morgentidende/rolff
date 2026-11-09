-- Conversation list preview (WhatsApp-like rows): one call returns every conversation of the caller
-- with its latest message that THIS caller may see, sorted by latest activity. No N+1 from the client.
--
-- Visibility is exactly get_messages(): active membership, message created after the caller joined,
-- inside the caller's retention, and either sent by the caller or released to the caller
-- (message_deliveries.released_at not null). Pending (receive-time held), rejected or never-committed
-- texts are therefore never previewed. Like get_messages, due deliveries are released first.
-- The preview is cut to 120 code points server-side; attachments return only their MIME type and
-- the caption (the automatic "Vedhæftning: <navn>" body is returned as null). No read-state exists,
-- so no unread count is returned.
-- list_my_conversations() is kept unchanged so older clients keep working.

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc, id desc);

create function public.list_my_conversations_v2()
returns table(id uuid, role public.member_role, members int, others jsonb, color text, pending_invitee text,
  last_at timestamptz, last_body text, last_mine boolean, last_sender_name text, last_att_mime text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); cut timestamptz;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  perform public._release_for(me, false);
  cut := public._retention_cutoff(me);
  return query
    select l.id, l.role, l.members, l.others, l.color, l.pending_invitee,
      lm.created_at, lm.preview, lm.mine, lm.sender_name, lm.att_mime
    from public.list_my_conversations() l
    join public.conversations c on c.id = l.id
    join public.memberships mem on mem.conversation_id = l.id and mem.user_id = me and mem.left_at is null
    left join lateral (
      select msg.created_at,
        case when a.message_id is not null and msg.body = 'Vedhæftning: ' || a.name then null
             else left(msg.body, 120) end as preview,
        coalesce(msg.sender_id = me, false) as mine,
        case when msg.sender_id is null then 'Slettet bruger'
             when msg.sender_id = me then null
             else public._label_for(me, msg.sender_id) end as sender_name,
        a.mime as att_mime
      from public.messages msg left join public.message_attachments a on a.message_id = msg.id
      where msg.conversation_id = l.id and msg.created_at >= mem.joined_at and msg.created_at >= cut
        and (msg.sender_id = me or exists (select 1 from public.message_deliveries d
               where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
      order by msg.created_at desc, msg.id desc
      limit 1
    ) lm on true
    order by coalesce(lm.created_at, c.created_at) desc, l.id;
end $$;
revoke execute on function public.list_my_conversations_v2() from public, anon;
grant execute on function public.list_my_conversations_v2() to authenticated;
