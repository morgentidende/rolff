-- Per-user, per-conversation toggles to decline photos and/or document files (PDF)
-- from other members. Off by default. Only the owner can read their own row.
-- The sender may learn that a type is declined in this conversation, never who
-- declined it and never whether a message was delivered or read.
-- This file is not applied by this workstream.

create table public.conversation_attachment_blocks (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  block_photos boolean not null default false,
  block_files boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_attachment_blocks enable row level security;
revoke all on table public.conversation_attachment_blocks from public, anon, authenticated;
grant select on table public.conversation_attachment_blocks to authenticated;
create policy attachment_blocks_own_select on public.conversation_attachment_blocks
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_member(conversation_id, auth.uid()));

create function public.get_my_attachment_blocks(conv uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r jsonb;
begin
  if auth.uid() is null or not public.is_active_member(conv, auth.uid()) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'block_photos', coalesce(b.block_photos, false),
    'block_files', coalesce(b.block_files, false)
  ) into r
  from (select conv as conversation_id) x
  left join public.conversation_attachment_blocks b
    on b.conversation_id = x.conversation_id and b.user_id = auth.uid();
  return r;
end $$;
revoke all on function public.get_my_attachment_blocks(uuid) from public, anon, authenticated;
grant execute on function public.get_my_attachment_blocks(uuid) to authenticated;

create function public.set_my_attachment_blocks(conv uuid, p_block_photos boolean, p_block_files boolean)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null or not public.is_active_member(conv, auth.uid()) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  if p_block_photos is null or p_block_files is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  insert into public.conversation_attachment_blocks(conversation_id, user_id, block_photos, block_files, updated_at)
  values (conv, auth.uid(), p_block_photos, p_block_files, now())
  on conflict (conversation_id, user_id) do update
    set block_photos = excluded.block_photos,
        block_files = excluded.block_files,
        updated_at = now();
  return public.get_my_attachment_blocks(conv);
end $$;
revoke all on function public.set_my_attachment_blocks(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_my_attachment_blocks(uuid, boolean, boolean) to authenticated;

-- Authenticated callers may only query as themselves. service_role passes p_sender.
create function public.recipient_attachment_blocks(conv uuid, p_sender uuid default auth.uid())
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r jsonb;
begin
  if p_sender is null then raise exception 'not_authorized' using errcode = 'P0001'; end if;
  if auth.uid() is not null and auth.uid() is distinct from p_sender then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if not public.is_active_member(conv, p_sender) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'block_photos', coalesce(bool_or(b.block_photos), false),
    'block_files', coalesce(bool_or(b.block_files), false)
  ) into r
  from public.memberships m
  left join public.conversation_attachment_blocks b
    on b.conversation_id = m.conversation_id and b.user_id = m.user_id
  where m.conversation_id = conv and m.left_at is null and m.user_id <> p_sender;
  return coalesce(r, jsonb_build_object('block_photos', false, 'block_files', false));
end $$;
revoke all on function public.recipient_attachment_blocks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.recipient_attachment_blocks(uuid, uuid) to authenticated, service_role;

create function public.enforce_attachment_type_blocks()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare conv uuid; sender uuid;
begin
  select conversation_id, sender_id into conv, sender from public.messages where id = new.message_id;
  if conv is null then raise exception 'invalid_message' using errcode = 'P0001'; end if;
  if new.mime = 'application/pdf' and exists (
    select 1
    from public.conversation_attachment_blocks b
    join public.memberships m on m.conversation_id = b.conversation_id and m.user_id = b.user_id and m.left_at is null
    where b.conversation_id = conv and b.user_id <> sender and b.block_files
  ) then
    raise exception 'blocked_files' using errcode = 'P0001';
  end if;
  if new.mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif') and exists (
    select 1
    from public.conversation_attachment_blocks b
    join public.memberships m on m.conversation_id = b.conversation_id and m.user_id = b.user_id and m.left_at is null
    where b.conversation_id = conv and b.user_id <> sender and b.block_photos
  ) then
    raise exception 'blocked_photos' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.enforce_attachment_type_blocks() from public, anon, authenticated;
create trigger message_attachments_type_blocks
  before insert or update of mime on public.message_attachments
  for each row execute function public.enforce_attachment_type_blocks();

create or replace function public.export_user_data(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if (select count(*) from export_log where user_id = p_uid and created_at > now() - interval '24 hours') >= 3
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into export_log(user_id) values (p_uid);
  select jsonb_build_object(
    'account', (select jsonb_build_object('user_id', u.id, 'email', u.email, 'created_at', u.created_at) from auth.users u where u.id = p_uid),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'public_name', p.public_name, 'locale', p.locale, 'theme', p.theme, 'ai_consent_at', p.ai_consent_at) from profiles p where p.user_id = p_uid),
    'privacy_settings', (select to_jsonb(x) - 'user_id' from user_privacy x where x.user_id = p_uid),
    'receive_settings', (select to_jsonb(x) - 'user_id' from receive_settings x where x.user_id = p_uid),
    'receive_windows', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' - 'id') from receive_windows x where x.user_id = p_uid), '[]'),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id, 'role', m.role, 'joined_at', m.joined_at, 'left_at', m.left_at)) from memberships m where m.user_id = p_uid), '[]'),
    'own_private_aliases', coalesce((select jsonb_agg(jsonb_build_object('contact_user_id', a.contact_user_id, 'alias', a.alias)) from contact_aliases a where a.owner_id = p_uid), '[]'),
    'own_blocked_topics', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_topics w where w.user_id = p_uid), '[]'),
    'own_blocked_words', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_words w where w.user_id = p_uid), '[]'),
    'own_attachment_blocks', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', b.conversation_id, 'block_photos', b.block_photos, 'block_files', b.block_files, 'updated_at', b.updated_at)) from conversation_attachment_blocks b where b.user_id = p_uid), '[]'),
    'own_conversation_blocks', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', b.conversation_id, 'created_at', b.created_at)) from conversation_blocks b where b.user_id = p_uid), '[]'),
    'invitations_created', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', i.conversation_id, 'role', i.role, 'invitee_email', i.invitee_email, 'created_at', i.created_at, 'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at)) from invitations i where i.created_by = p_uid), '[]'),
    'consents_given', coalesce((select jsonb_agg(jsonb_build_object('invitation_id', c.invitation_id, 'role', c.role, 'created_at', c.created_at)) from invitation_consents c where c.user_id = p_uid), '[]'),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('category', f.category, 'body', f.body, 'created_at', f.created_at)) from feedback f where f.user_id = p_uid), '[]'),
    'reports_metadata', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', r2.conversation_id, 'category', r2.category, 'attached_count', r2.attached_count, 'created_at', r2.created_at)) from report_log r2 where r2.user_id = p_uid), '[]'),
    'moderation_attempts_metadata', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', a.conversation_id, 'decision', a.decision, 'reason_code', a.reason_code, 'created_at', a.created_at)) from moderation_attempts a where a.sender_id = p_uid), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.export_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
