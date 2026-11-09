-- Moderation context for replies (Besvar): Luna always gets the replied-to message, even when it
-- is older than the last 5 context messages sent with every check.
--
-- Server-only (service_role). The target must first pass assert_reply_target, i.e. exactly the
-- rules the sender already has for replying: same conversation, active non-reader membership,
-- created after the sender joined, inside the sender's retention, and sent by the sender or
-- released to the sender. Anything the sender cannot see raises invalid_reply and returns nothing.
-- Data minimisation: only who wrote it (sender/other) and the first 300 characters leave the DB.
-- "newer" = how many messages visible in prepare_send's context are newer than the target, so the
-- Edge function can avoid sending it twice when it is already among the last 5.
create function public.reply_moderation_context(p_sender uuid, conv uuid, p_reply uuid)
returns table(mine boolean, body text, newer int)
language plpgsql security definer set search_path = public as $$
declare mem memberships; t messages;
begin
  if p_reply is null then return; end if;
  perform assert_reply_target(p_sender, conv, p_reply);
  select * into mem from memberships where conversation_id = conv and user_id = p_sender and left_at is null;
  select * into t from messages where id = p_reply and conversation_id = conv;
  return query select
    coalesce(t.sender_id = p_sender, false),
    left(t.body, 300),
    (select count(*)::int from messages n
      where n.conversation_id = conv and n.created_at >= mem.joined_at and n.created_at > t.created_at
        and (n.sender_id = p_sender or exists(select 1 from message_deliveries d
               where d.message_id = n.id and d.recipient_id = p_sender and d.released_at is not null)));
end $$;
revoke execute on function public.reply_moderation_context(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.reply_moderation_context(uuid,uuid,uuid) to service_role;
