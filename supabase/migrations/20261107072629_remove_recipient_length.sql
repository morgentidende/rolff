-- Recipient-configurable LENGTH limits are retired. Sender-plan quotas remain160/480.
-- Preserve legacy signatures/columns so older clients do not break or reinstate a cap.
-- Existing max_chars values remain inert; no messages or frequency settings are deleted.
comment on column public.person_limits.max_chars is 'Deprecated: ignored. Message length is determined solely by the sender plan.';

create or replace function public.set_person_limit(p_sender uuid, p_max_chars int, p_interval_min int)
returns table(max_chars int, interval_min int) language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated' using errcode='P0001'; end if;
  if p_sender is null or p_sender = me or not exists (select 1 from memberships a join memberships b on a.conversation_id=b.conversation_id
      where a.user_id=me and b.user_id=p_sender and a.left_at is null and b.left_at is null)
    then raise exception 'not_found' using errcode='P0001'; end if;
  if p_interval_min is not null and (p_interval_min < 1 or p_interval_min > 1440) then raise exception 'bad_interval' using errcode='P0001'; end if;
  if p_interval_min is null then
    delete from person_limits where recipient_id=me and sender_id=p_sender;
  else
    insert into person_limits values (me, p_sender, null, p_interval_min, now())
      on conflict (recipient_id, sender_id) do update set max_chars=excluded.max_chars, interval_min=excluded.interval_min, updated_at=now();
  end if;
  return query select null::int, p_interval_min;
end $$;
revoke execute on function public.set_person_limit(uuid,int,int) from public, anon;
grant execute on function public.set_person_limit(uuid,int,int) to authenticated;


-- Frequency calculation and privileges are unchanged; length fields always return NULL.
create or replace function public._send_limits(conv uuid, p_sender uuid)
returns table(max_chars int, chars_by uuid, next_at timestamptz, next_by uuid)
language sql stable security definer set search_path = public as $$
  with r as (
    select l.recipient_id, l.interval_min,
      (select max(msg.created_at) from message_deliveries d join messages msg on msg.id=d.message_id
        where d.recipient_id=l.recipient_id and msg.sender_id=p_sender) as last_at
    from person_limits l join memberships m on m.user_id=l.recipient_id and m.conversation_id=conv and m.left_at is null
    where l.sender_id=p_sender),
  f as (select recipient_id, last_at + make_interval(mins => interval_min) t from r
        where interval_min is not null and last_at is not null and last_at + make_interval(mins => interval_min) > clock_timestamp()
        order by t desc, recipient_id limit 1)
  select null::int, null::uuid, (select t from f), (select recipient_id from f);
$$;
revoke execute on function public._send_limits(uuid,uuid) from public, anon, authenticated;
grant execute on function public._send_limits(uuid,uuid) to service_role;
