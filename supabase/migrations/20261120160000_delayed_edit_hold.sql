-- Edit-hold for delayed messages.
-- Tapping "Ret" on a counting delayed message puts it on HOLD on the server:
--   deliver_after = 'infinity'. Every existing release path already requires
--   deliver_after <= clock_timestamp() (_release_for, my_pending_count), so a held message
--   is never delivered, even if the app is closed or the edit takes longer than the
--   remaining time. A held message stays held until the sender
--     - saves the edit  -> update_delayed_message (new moderation approval) starts a fresh
--                          full 30 s delay with the new text,
--     - cancels the edit / taps "Genoptag" -> resume_delayed_message starts a fresh full
--                          30 s delay with the unchanged (already moderated) original,
--     - deletes it      -> cancel_delayed_message.
--   There is deliberately NO automatic resume: an abandoned hold never delivers silently.
-- No change to send-message / send-attachment: update_delayed_message already treats a
-- held message as still pending, and the edit text is moderated exactly as before.

-- Sender taps "Ret". Only while the message is still counting (not due, not released).
-- Takes the same per-recipient advisory lock the release path takes (exclusive vs. its
-- shared lock), so a release that is already running either finishes first (then the
-- hold is refused with no_longer_pending) or waits until the hold is committed (then it
-- sees deliver_after = 'infinity' and releases nothing).
create function public.hold_delayed_message(p_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); m public.messages; r uuid;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into m from public.messages where id=p_id and sender_id=me for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if m.deliver_after = 'infinity'::timestamptz then return true; end if;
  for r in select d.recipient_id from public.message_deliveries d where d.message_id=m.id order by d.recipient_id loop
    perform pg_advisory_xact_lock(hashtextextended('rolff:receive:'||r::text,0));
  end loop;
  -- Fresh statements below see everything a concurrent release committed.
  if not public._delayed_pending(p_id) then
    raise exception 'no_longer_pending' using errcode='P0001';
  end if;
  update public.messages set deliver_after = 'infinity'::timestamptz where id=m.id;
  return true;
end $$;
revoke all on function public.hold_delayed_message(uuid) from public, anon;
grant execute on function public.hold_delayed_message(uuid) to authenticated;

-- Sender cancels the edit (X) or taps "Genoptag": fresh full delay with the stored text.
-- Idempotent for a message that is already counting; refused once delivered/due.
create function public.resume_delayed_message(p_id uuid)
returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); m public.messages; due timestamptz;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into m from public.messages where id=p_id and sender_id=me for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if not public._delayed_pending(p_id) then raise exception 'no_longer_pending' using errcode='P0001'; end if;
  if m.deliver_after <> 'infinity'::timestamptz then return m.deliver_after; end if;
  due := clock_timestamp() + interval '30 seconds';
  update public.messages set deliver_after = due where id=m.id;
  return due;
end $$;
revoke all on function public.resume_delayed_message(uuid) from public, anon;
grant execute on function public.resume_delayed_message(uuid) to authenticated;

-- "Send now" must never override a hold: the sender has to resume or save first.
create or replace function public.release_delayed_message(p_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into m from public.messages where id=p_id and sender_id=me for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if m.deliver_after = 'infinity'::timestamptz then raise exception 'held' using errcode='P0001'; end if;
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

-- get_messages_v3 now also says whether the sender's own message is on hold. A held
-- message has deliver_after = null for the client (no countdown) and held = true.
-- get_messages_v2 is unchanged (its deliver_after may read 'infinity' for a held message).
drop function if exists public.get_messages_v3(uuid);
create function public.get_messages_v3(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean,
  att_mime text, att_name text, att_alt text, att_pages int, sender_email text,
  reply_to_id uuid, reply_body text, has_reply boolean, thumb_count int, i_thumbed boolean, deliver_after timestamptz, held boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query with visible as materialized (select * from get_messages_v2(conv))
    select g.id, g.sender_id, g.sender_name, g.body, g.created_at, g.mine, g.att_mime, g.att_name, g.att_alt, g.att_pages,
      g.sender_email, g.reply_to_id, g.reply_body, g.has_reply,
      (select count(*)::int from message_reactions r where r.message_id = g.id),
      exists(select 1 from message_reactions r where r.message_id = g.id and r.user_id = auth.uid()),
      case when g.deliver_after = 'infinity'::timestamptz then null else g.deliver_after end,
      coalesce(g.deliver_after = 'infinity'::timestamptz, false)
    from visible g
    order by g.created_at, g.id;
end $$;
revoke execute on function public.get_messages_v3(uuid) from public, anon;
grant execute on function public.get_messages_v3(uuid) to authenticated;
