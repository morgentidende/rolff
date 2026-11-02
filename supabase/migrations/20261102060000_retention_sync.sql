-- Step 2: retention choice (1y default / 5y / unlimited) and cloud-sync opt-in (default off).
-- Retention is per user: get_messages hides messages older than the CALLER's retention. A message is
-- physically deleted by retention_sweep() only when it is older than the retention of EVERY active
-- member (evidence model: someone who chose a longer period keeps their copy).
create or replace function public._retention_cutoff(uid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case coalesce((select retention from user_privacy where user_id = uid), '1y')
    when '1y' then now() - interval '1 year' when '5y' then now() - interval '5 years' else '-infinity'::timestamptz end
$$;
revoke execute on function public._retention_cutoff(uuid) from public, anon, authenticated;

create or replace function public.set_my_data_prefs(p_cloud_sync boolean, p_retention text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_retention not in ('1y','5y','unlimited') or p_cloud_sync is null then raise exception 'bad_input' using errcode='22023'; end if;
  insert into user_privacy(user_id, cloud_sync, retention) values (auth.uid(), p_cloud_sync, p_retention)
  on conflict (user_id) do update set cloud_sync = excluded.cloud_sync, retention = excluded.retention, updated_at = now();
end $$;
revoke execute on function public.set_my_data_prefs(boolean,text) from public, anon;
grant execute on function public.set_my_data_prefs(boolean,text) to authenticated;

create or replace function public.get_messages(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships; cut timestamptz;
begin
  select * into mem from memberships where conversation_id=conv and user_id=me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  perform _release_for(me, false);
  cut := _retention_cutoff(me);
  return query
    select msg.id, msg.sender_id, case when msg.sender_id is null then 'Slettet bruger' else _label_for(me, msg.sender_id) end,
      msg.body, msg.created_at, coalesce(msg.sender_id = me, false)
    from messages msg
    where msg.conversation_id = conv and msg.created_at >= mem.joined_at and msg.created_at >= cut
      and (msg.sender_id = me or exists (select 1 from message_deliveries d
             where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
    order by msg.created_at asc limit 500;
end $$;

-- Service only (daily cron via inactivity-sweep). Returns number of deleted messages.
create or replace function public.retention_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with doomed as (
    select msg.id from messages msg
    where msg.created_at < now() - interval '1 year'
      and not exists (select 1 from memberships m where m.conversation_id = msg.conversation_id and m.left_at is null
                      and msg.created_at >= _retention_cutoff(m.user_id)))
  delete from messages where id in (select id from doomed);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.retention_sweep() from public, anon, authenticated;
grant execute on function public.retention_sweep() to service_role;
