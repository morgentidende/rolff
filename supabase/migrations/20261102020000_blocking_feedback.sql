-- Per-conversation blocked words. Each member (incl. read-only readers) owns their own list.
-- Privacy: a member can only SELECT their own words; send-message (service role) checks other
-- members' words and returns only the single matched word to the sender, never the list or who blocked it.
create table if not exists public.conversation_blocked_words (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null check (char_length(word) between 2 and 40),
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id, word)
);
alter table public.conversation_blocked_words enable row level security;
revoke all on public.conversation_blocked_words from anon, authenticated;
grant select, delete on public.conversation_blocked_words to authenticated;
grant all on public.conversation_blocked_words to service_role;
create policy cbw_own_select on public.conversation_blocked_words for select to authenticated
  using (user_id = auth.uid() and public.is_active_member(conversation_id, auth.uid()));
create policy cbw_own_delete on public.conversation_blocked_words for delete to authenticated
  using (user_id = auth.uid());

-- Add via RPC: membership check, normalisation (trim, lowercase, collapse spaces), max 50 per user/conversation.
create or replace function public.add_blocked_word(conv uuid, p_word text, p_ack boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w text; wid uuid;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not public.is_active_member(conv, me) then raise exception 'not_member' using errcode='42501'; end if;
  -- The user must confirm (per word) that the sender will be told which word matched.
  if p_ack is not true then raise exception 'ack_required' using errcode='P0001'; end if;
  w := lower(regexp_replace(trim(coalesce(p_word,'')), '\s+', ' ', 'g'));
  if char_length(w) < 2 or char_length(w) > 40 then raise exception 'length' using errcode='P0001'; end if;
  if (select count(*) from conversation_blocked_words where conversation_id=conv and user_id=me) >= 50
    then raise exception 'too_many' using errcode='P0001'; end if;
  insert into conversation_blocked_words(conversation_id, user_id, word) values (conv, me, w)
    on conflict (conversation_id, user_id, word) do update set word = excluded.word returning id into wid;
  return wid;
end $$;
revoke execute on function public.add_blocked_word(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.add_blocked_word(uuid,text,boolean) to authenticated;

-- Service only: blocked words of the OTHER active members (never returned to clients).
create or replace function public.recipient_blocked_words(conv uuid, p_sender uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select distinct b.word from conversation_blocked_words b join memberships m
    on m.conversation_id = b.conversation_id and m.user_id = b.user_id and m.left_at is null
  where b.conversation_id = conv and b.user_id <> p_sender;
$$;
revoke execute on function public.recipient_blocked_words(uuid,uuid) from public, anon, authenticated;
grant execute on function public.recipient_blocked_words(uuid,uuid) to service_role;

-- Conversation blocking: permanent until the blocking user removes it. No expiry.
create table public.conversation_blocks (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.conversation_blocks enable row level security;
revoke all on public.conversation_blocks from public, anon, authenticated;
grant select on public.conversation_blocks to authenticated;
grant all on public.conversation_blocks to service_role;
create policy cb_own_select on public.conversation_blocks for select to authenticated using (user_id = auth.uid());

create or replace function public.block_conversation(conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member(conv, auth.uid()) then raise exception 'not_member' using errcode='42501'; end if;
  insert into conversation_blocks(conversation_id, user_id) values (conv, auth.uid()) on conflict do nothing;
end $$;
create or replace function public.unblock_conversation(conv uuid) returns void
language sql security definer set search_path = public as $$
  delete from conversation_blocks where conversation_id = conv and user_id = auth.uid();
$$;
revoke execute on function public.block_conversation(uuid), public.unblock_conversation(uuid) from public, anon;
grant execute on function public.block_conversation(uuid), public.unblock_conversation(uuid) to authenticated;

-- Server enforcement: nobody else can add a message while another active member blocks the conversation.
create or replace function public._enforce_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from conversation_blocks b join memberships m on m.conversation_id = b.conversation_id and m.user_id = b.user_id and m.left_at is null
             where b.conversation_id = new.conversation_id and b.user_id is distinct from new.sender_id)
  then raise exception 'cannot_deliver' using errcode='42501'; end if;
  return new;
end $$;
create trigger messages_enforce_block before insert on public.messages for each row execute function public._enforce_block();

-- Feedback categories: Forslag / Klage / Filter-feedback.
alter table public.feedback drop constraint if exists feedback_category_check;
alter table public.feedback add constraint feedback_category_check check (category in ('suggestion','complaint','filter','idea','problem','other'));
