-- Signup: record AI consent and 18+ confirmation timestamps from auth metadata (server-side).
-- Existing accounts keep null timestamps. Clients cannot overwrite the columns.
alter table public.profiles add column if not exists age_confirmed_at timestamptz;

create or replace function public._meta_flag(meta jsonb, k text) returns boolean
language sql immutable as $$
  select lower(coalesce(meta->>k, '')) in ('true', 't', '1', 'yes');
$$;
revoke all on function public._meta_flag(jsonb, text) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles(user_id, display_name, ai_consent_at, age_confirmed_at)
  values (
    new.id,
    coalesce(nullif(meta->>'display_name', ''), 'Bruger'),
    case when public._meta_flag(meta, 'ai_consent') then now() end,
    case when public._meta_flag(meta, 'age_18') then now() end
  )
  on conflict (user_id) do update set
    ai_consent_at = coalesce(profiles.ai_consent_at, excluded.ai_consent_at),
    age_confirmed_at = coalesce(profiles.age_confirmed_at, excluded.age_confirmed_at);
  return new;
end $$;

-- Prevent the signed-in user from changing these stamps via ordinary profile updates.
revoke update (ai_consent_at, age_confirmed_at) on public.profiles from authenticated;

create or replace function public.protect_signup_stamps() returns trigger
language plpgsql as $$
begin
  -- Once set, the stamps cannot be changed or cleared (including by the account holder).
  new.ai_consent_at := coalesce(old.ai_consent_at, new.ai_consent_at);
  new.age_confirmed_at := coalesce(old.age_confirmed_at, new.age_confirmed_at);
  return new;
end $$;
drop trigger if exists profiles_protect_signup_stamps on public.profiles;
create trigger profiles_protect_signup_stamps
  before update on public.profiles
  for each row execute function public.protect_signup_stamps();

create or replace function public.export_user_data(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if (select count(*) from export_log where user_id = p_uid and created_at > now() - interval '24 hours') >= 3
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into export_log(user_id) values (p_uid);
  select jsonb_build_object(
    'account', (select jsonb_build_object('user_id', u.id, 'email', u.email, 'created_at', u.created_at) from auth.users u where u.id = p_uid),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'public_name', p.public_name, 'locale', p.locale, 'theme', p.theme, 'ai_consent_at', p.ai_consent_at, 'age_confirmed_at', p.age_confirmed_at) from profiles p where p.user_id = p_uid),
    'privacy_settings', (select to_jsonb(x) - 'user_id' from user_privacy x where x.user_id = p_uid),
    'receive_settings', (select to_jsonb(x) - 'user_id' from receive_settings x where x.user_id = p_uid),
    'receive_windows', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' - 'id') from receive_windows x where x.user_id = p_uid), '[]'),
    'conversation_receive_settings', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from conversation_receive_settings x where x.user_id = p_uid), '[]'),
    'conversation_receive_windows', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' - 'id') from conversation_receive_windows x where x.user_id = p_uid), '[]'),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id, 'role', m.role, 'joined_at', m.joined_at, 'left_at', m.left_at)) from memberships m where m.user_id = p_uid), '[]'),
    'own_private_aliases', coalesce((select jsonb_agg(jsonb_build_object('contact_user_id', a.contact_user_id, 'alias', a.alias)) from contact_aliases a where a.owner_id = p_uid), '[]'),
    'own_blocked_topics', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_topics w where w.user_id = p_uid), '[]'),
    'own_blocked_words', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_words w where w.user_id = p_uid), '[]'),
    'own_attachment_blocks', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', b.conversation_id, 'block_photos', b.block_photos, 'block_files', b.block_files, 'updated_at', b.updated_at)) from conversation_attachment_blocks b where b.user_id = p_uid), '[]'),
    'own_conversation_blocks', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', b.conversation_id, 'created_at', b.created_at)) from conversation_blocks b where b.user_id = p_uid), '[]'),
    'invitations_created', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', i.conversation_id, 'role', i.role, 'invitee_email', i.invitee_email, 'created_at', i.created_at, 'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at, 'private_nickname', (select ia.alias from invitation_aliases ia where ia.invitation_id = i.id and ia.owner_id = p_uid))) from invitations i where i.created_by = p_uid), '[]'),
    'consents_given', coalesce((select jsonb_agg(jsonb_build_object('invitation_id', c.invitation_id, 'role', c.role, 'created_at', c.created_at)) from invitation_consents c where c.user_id = p_uid), '[]'),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('category', f.category, 'body', f.body, 'created_at', f.created_at)) from feedback f where f.user_id = p_uid), '[]'),
    'reports_metadata', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', r2.conversation_id, 'category', r2.category, 'attached_count', r2.attached_count, 'created_at', r2.created_at)) from report_log r2 where r2.user_id = p_uid), '[]'),
    'moderation_attempts_metadata', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', a.conversation_id, 'decision', a.decision, 'reason_code', a.reason_code, 'created_at', a.created_at)) from moderation_attempts a where a.sender_id = p_uid), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.export_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
