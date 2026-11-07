-- Product quotas are Unicode code points, not SMS transport encoding/segments.
-- _effective_plan locks/apply-pending-downgrade on the authoritative plan row.
create or replace function public.message_char_limit(uid uuid)
returns integer language sql security definer set search_path=public as $$
  select case public._effective_plan(uid) when 'text_attachments' then 480 else 160 end
$$;
revoke all on function public.message_char_limit(uuid) from public, anon, authenticated;
grant execute on function public.message_char_limit(uuid) to service_role;

-- Only INSERT is checked: accepted historical messages and idempotent retries are
-- not retroactively changed by a downgrade. Covers both old and reply commit RPCs.
create or replace function public.enforce_message_plan_length()
returns trigger language plpgsql security definer set search_path=public as $$
declare cap integer;
begin
  cap := public.message_char_limit(new.sender_id);
  if char_length(new.body) > cap then
    raise exception 'plan_length_limit:%', cap using errcode='22001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_message_plan_length() from public, anon, authenticated;
create trigger messages_plan_length before insert on public.messages
  for each row execute function public.enforce_message_plan_length();

create or replace function public.prepare_send(p_sender uuid, conv uuid, p_body text)
returns table(ctx_mine boolean, ctx_body text)
language plpgsql security definer set search_path = public as $$
declare mem memberships;
begin
  select * into mem from memberships where conversation_id=conv and user_id=p_sender and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  if mem.role = 'reader' then raise exception 'read_only' using errcode='42501'; end if;
  if char_length(p_body) < 1 or char_length(p_body) > 480 then raise exception 'length' using errcode='22001'; end if;
  if char_length(p_body) > public.message_char_limit(p_sender) then
    raise exception 'plan_length_limit:%', public.message_char_limit(p_sender) using errcode='22001';
  end if;
  if (select count(*) from moderation_attempts where sender_id=p_sender and created_at > now() - interval '1 minute') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  return query
    select x.mine, x.body from (
      select msg.sender_id = p_sender as mine, msg.body, msg.created_at
      from messages msg where msg.conversation_id=conv and msg.created_at >= mem.joined_at
        and (msg.sender_id=p_sender or exists(select 1 from message_deliveries d where d.message_id=msg.id and d.recipient_id=p_sender and d.released_at is not null))
      order by msg.created_at desc limit 10) x order by x.created_at asc;
end $$;
