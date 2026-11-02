-- Per-person limits set by a RECIPIENT for one SENDER, across all shared conversations.
-- max_chars: null = unlimited, else 80..10000. interval_min: null = no limit, else 1..1440 (24 h).
create table if not exists public.person_limits (
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  max_chars int check (max_chars between 80 and 10000),
  interval_min int check (interval_min between 1 and 1440),
  updated_at timestamptz not null default now(),
  primary key (recipient_id, sender_id),
  check (recipient_id <> sender_id)
);
alter table public.person_limits enable row level security;
revoke all on public.person_limits from anon, authenticated;
grant select on public.person_limits to authenticated;
grant all on public.person_limits to service_role;
drop policy if exists pl_own_select on public.person_limits;
create policy pl_own_select on public.person_limits for select to authenticated using (recipient_id = auth.uid());
create index if not exists message_deliveries_recipient on public.message_deliveries(recipient_id);

-- Recipient sets/clears limits for a person they share an active conversation with.
create or replace function public.set_person_limit(p_sender uuid, p_max_chars int, p_interval_min int)
returns table(max_chars int, interval_min int) language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated' using errcode='P0001'; end if;
  if p_sender is null or p_sender = me or not exists (select 1 from memberships a join memberships b on a.conversation_id=b.conversation_id
      where a.user_id=me and b.user_id=p_sender and a.left_at is null and b.left_at is null)
    then raise exception 'not_found' using errcode='P0001'; end if;
  if p_max_chars is not null and (p_max_chars < 80 or p_max_chars > 10000) then raise exception 'bad_max_chars' using errcode='P0001'; end if;
  if p_interval_min is not null and (p_interval_min < 1 or p_interval_min > 1440) then raise exception 'bad_interval' using errcode='P0001'; end if;
  if p_max_chars is null and p_interval_min is null then
    delete from person_limits where recipient_id=me and sender_id=p_sender;
  else
    insert into person_limits values (me, p_sender, p_max_chars, p_interval_min, now())
      on conflict (recipient_id, sender_id) do update set max_chars=excluded.max_chars, interval_min=excluded.interval_min, updated_at=now();
  end if;
  return query select p_max_chars, p_interval_min;
end $$;
revoke execute on function public.set_person_limit(uuid,int,int) from public, anon;
grant execute on function public.set_person_limit(uuid,int,int) to authenticated;

-- Limits that apply to p_sender in conv: strictest over active recipients. Reveals only the limit
-- (and which member set the binding one, so the sender can be told "X has set a limit").
create or replace function public._send_limits(conv uuid, p_sender uuid)
returns table(max_chars int, chars_by uuid, next_at timestamptz, next_by uuid)
language sql stable security definer set search_path = public as $$
  with r as (
    select l.recipient_id, l.max_chars, l.interval_min,
      (select max(msg.created_at) from message_deliveries d join messages msg on msg.id=d.message_id
        where d.recipient_id=l.recipient_id and msg.sender_id=p_sender) as last_at
    from person_limits l join memberships m on m.user_id=l.recipient_id and m.conversation_id=conv and m.left_at is null
    where l.sender_id=p_sender),
  c as (select recipient_id, max_chars from r where max_chars is not null order by max_chars, recipient_id limit 1),
  f as (select recipient_id, last_at + make_interval(mins => interval_min) t from r
        where interval_min is not null and last_at is not null and last_at + make_interval(mins => interval_min) > clock_timestamp()
        order by t desc, recipient_id limit 1)
  select (select max_chars from c), (select recipient_id from c), (select t from f), (select recipient_id from f);
$$;
revoke execute on function public._send_limits(uuid,uuid) from public, anon, authenticated;
grant execute on function public._send_limits(uuid,uuid) to service_role;

-- For the sender's own composer: only the binding limits in this conversation.
create or replace function public.get_my_send_limits(conv uuid)
returns table(max_chars int, chars_by uuid, next_at timestamptz, next_by uuid, multi boolean)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from memberships where conversation_id=conv and user_id=me and left_at is null) then return; end if;
  return query select s.*, (select count(*) from memberships where conversation_id=conv and left_at is null and user_id<>me) > 1
    from _send_limits(conv, me) s;
end $$;
revoke execute on function public.get_my_send_limits(uuid) from public, anon;
grant execute on function public.get_my_send_limits(uuid) to authenticated;

-- Hard DB backstop for frequency (length is checked in the edge functions, where the attachment caption is known).
create or replace function public._person_freq_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from _send_limits(new.conversation_id, new.sender_id) s where s.next_at is not null) then
    raise exception 'person_frequency' using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists messages_person_freq on public.messages;
create trigger messages_person_freq before insert on public.messages for each row execute function public._person_freq_guard();

-- Blocked words: allow whole sentences (up to 120 chars).
alter table public.conversation_blocked_words drop constraint if exists conversation_blocked_words_word_check;
alter table public.conversation_blocked_words add constraint conversation_blocked_words_word_check check (char_length(word) between 2 and 120);
create or replace function public.add_blocked_word(conv uuid, p_word text, p_ack boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w text; wid uuid;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(conv, me) then raise exception 'not_member' using errcode='42501'; end if;
  -- The user must confirm (per word) that the sender will be told which word matched.
  if p_ack is not true then raise exception 'ack_required' using errcode='P0001'; end if;
  w := lower(regexp_replace(trim(coalesce(p_word,'')), '\s+', ' ', 'g'));
  if char_length(w) < 2 or char_length(w) > 120 then raise exception 'length' using errcode='P0001'; end if;
  if (select count(*) from conversation_blocked_words where conversation_id=conv and user_id=me) >= 50
    then raise exception 'too_many' using errcode='P0001'; end if;
  insert into conversation_blocked_words(conversation_id, user_id, word) values (conv, me, w)
    on conflict (conversation_id, user_id, word) do update set word = excluded.word returning id into wid;
  return wid;
end $$;
revoke execute on function public.add_blocked_word(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.add_blocked_word(uuid,text,boolean) to authenticated;

-- Adding an extra participant requires the INVITER's plan 'text_attachments'. Only the inviter's plan counts.
create or replace function public.create_member_invitation(conv uuid, p_email text, p_role public.member_role)
returns table(invitation_id uuid, token text, invitee_email text, inviter_email text, complete boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); c conversations; em text := lower(trim(p_email)); inv uuid; raw text; i invitations; my_email text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_role not in ('writer','reader') then raise exception 'bad_role' using errcode='22023'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(em) > 254 then raise exception 'bad_email' using errcode='22023'; end if;
  select * into c from conversations where id = conv for update;
  if not found or not exists (select 1 from memberships where conversation_id = conv and user_id = me and left_at is null and role = 'parent')
    then raise exception 'forbidden' using errcode='42501'; end if;
  if _effective_plan(me) <> 'text_attachments' then raise exception 'plan_required' using errcode='P0001'; end if;
  if exists (select 1 from memberships m join auth.users u on u.id = m.user_id where m.conversation_id = conv and m.left_at is null and lower(u.email) = em)
    then raise exception 'bad_email' using errcode='22023'; end if;
  if (select count(*) from invitations where created_by = me and created_at > now() - interval '24 hours') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  select email into my_email from auth.users where id = me;
  -- placeholder hash: never revealed, so the invitation is unusable until everyone consents
  insert into invitations(conversation_id, created_by, role, token_hash, member_version, expires_at, invitee_email)
    values (conv, me, p_role, digest(gen_random_bytes(32),'sha256'), c.member_version, now() + interval '7 days', em) returning id into inv;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, me, c.member_version, p_role);
  select * into i from invitations where id = inv;
  if _all_consented(i) then
    raw := encode(gen_random_bytes(24),'hex');
    update invitations set token_hash = digest(raw,'sha256'), expires_at = now() + interval '72 hours' where id = inv;
  end if;
  return query select inv, raw, em, my_email, raw is not null;
end $$;
