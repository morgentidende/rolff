-- Daily attachment cap: at most 5 attachments per sender in any rolling 24 hours (same window style as the
-- other per-day limits). Replaces the old cap of 20 that was only checked at commit, i.e. AFTER the model call.
--  * attachment_slots: short-lived reservations taken right before the model call, so parallel uploads
--    cannot all pass the check and each cost tokens.
--  * commit_attachment_message: same lock, same count; backstop if anything slips through.
-- Counted: sent attachments (messages with a message_attachments row) + in-flight reservations (< 3 min,
-- no message with that idempotency key yet). Attachments blocked by moderation do not use up the allowance.
-- Only service_role (Edge functions) can call these. Nothing here changes existing data.

create table if not exists public.attachment_slots (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, idempotency_key)
);
alter table public.attachment_slots enable row level security; -- no policies: only via functions
create index if not exists attachment_slots_user_created on public.attachment_slots(user_id, created_at);

create or replace function public._attachment_daily_limit() returns int language sql immutable as $$ select 5 $$;

create or replace function public._attachment_sent_24h(p_sender uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from messages m join message_attachments a on a.message_id = m.id
   where m.sender_id = p_sender and m.created_at > clock_timestamp() - interval '24 hours'
$$;

create or replace function public.attachment_daily_used(p_sender uuid) returns int
language sql stable security definer set search_path = public as $$
  select public._attachment_sent_24h(p_sender)
       + (select count(*)::int from attachment_slots s
           where s.user_id = p_sender and s.created_at > clock_timestamp() - interval '3 minutes'
             and not exists (select 1 from messages m where m.sender_id = s.user_id and m.idempotency_key = s.idempotency_key))
$$;

create or replace function public.reserve_attachment_slot(p_sender uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('attach_day:' || p_sender::text, 0));
  delete from attachment_slots where user_id = p_sender and created_at < clock_timestamp() - interval '1 day';
  delete from attachment_slots where user_id = p_sender and idempotency_key = p_key; -- a retry takes a fresh slot
  if public.attachment_daily_used(p_sender) >= public._attachment_daily_limit() then
    raise exception 'daily_attachment_limit' using errcode = 'P0001';
  end if;
  insert into attachment_slots(user_id, idempotency_key) values (p_sender, p_key);
end $$;

create or replace function public.release_attachment_slot(p_sender uuid, p_key text) returns void
language sql security definer set search_path = public as $$
  delete from attachment_slots where user_id = p_sender and idempotency_key = p_key
$$;

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
  perform pg_advisory_xact_lock(hashtextextended('attach_day:' || p_sender::text, 0));
  if public._attachment_sent_24h(p_sender) >= public._attachment_daily_limit() then raise exception 'daily_attachment_limit' using errcode='P0001'; end if;
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
  delete from attachment_slots where user_id = p_sender and idempotency_key = p_key;
  return query select mid, false;
end $$;

revoke execute on function public._attachment_daily_limit(), public._attachment_sent_24h(uuid), public.attachment_daily_used(uuid),
  public.reserve_attachment_slot(uuid,text), public.release_attachment_slot(uuid,text) from public, anon, authenticated;
grant execute on function public._attachment_daily_limit(), public._attachment_sent_24h(uuid), public.attachment_daily_used(uuid),
  public.reserve_attachment_slot(uuid,text), public.release_attachment_slot(uuid,text) to service_role;
revoke execute on function public.commit_attachment_message(uuid,uuid,uuid,text,text,text,text,text,int,bytea) from public, anon, authenticated;
grant execute on function public.commit_attachment_message(uuid,uuid,uuid,text,text,text,text,text,int,bytea) to service_role;
