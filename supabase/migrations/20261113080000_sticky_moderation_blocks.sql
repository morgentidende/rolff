-- Sticky moderation blocks: once Luna (or the prefilter) blocks a text, the same sender cannot get the
-- same (normalized) text through in the same conversation by simply pressing send again and hoping the
-- model answers differently. Only a hash of the normalized text is stored, never the text itself.
create table if not exists public.moderation_block_memory (
  sender_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  reason_code text not null check (char_length(reason_code) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (sender_id, conversation_id, text_hash)
);
create index if not exists moderation_block_memory_expires on public.moderation_block_memory(expires_at);
alter table public.moderation_block_memory enable row level security;
revoke all on public.moderation_block_memory from public, anon, authenticated;
grant all on public.moderation_block_memory to service_role;

-- Remember (or refresh) a block. TTL is clamped to 1 hour .. 30 days. Also prunes this sender's expired rows.
create or replace function public.remember_moderation_block(p_sender uuid, conv uuid, p_hash text, p_reason text, p_ttl_hours int default 168)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_hash !~ '^[0-9a-f]{64}$' or p_reason is null or p_reason in ('none', 'unclear_meaning') then
    raise exception 'invalid_block' using errcode = '22023';
  end if;
  delete from moderation_block_memory where sender_id = p_sender and expires_at <= now();
  insert into moderation_block_memory(sender_id, conversation_id, text_hash, reason_code, expires_at)
  values (p_sender, conv, p_hash, p_reason, now() + make_interval(hours => least(greatest(coalesce(p_ttl_hours, 168), 1), 720)))
  on conflict (sender_id, conversation_id, text_hash)
  do update set reason_code = excluded.reason_code, expires_at = greatest(moderation_block_memory.expires_at, excluded.expires_at);
end $$;

-- Reason code of an unexpired earlier block of exactly this normalized text, or null.
create or replace function public.recent_moderation_block(p_sender uuid, conv uuid, p_hash text)
returns text language sql stable security definer set search_path = public as $$
  select reason_code from moderation_block_memory
   where sender_id = p_sender and conversation_id = conv and text_hash = p_hash and expires_at > now()
$$;

revoke all on function public.remember_moderation_block(uuid, uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.recent_moderation_block(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.remember_moderation_block(uuid, uuid, text, text, int) to service_role;
grant execute on function public.recent_moderation_block(uuid, uuid, text) to service_role;
