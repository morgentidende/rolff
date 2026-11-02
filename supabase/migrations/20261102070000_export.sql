-- Step 3: "Download mine data" (GDPR art. 15). Only the caller's OWN data. Messages are fetched
-- separately with the caller's JWT through get_messages (same visibility rules as the app).
create table public.export_log (user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
alter table public.export_log enable row level security;
revoke all on public.export_log from anon, authenticated;
grant all on public.export_log to service_role;

-- Service only. Raises rate_limited after 3 exports per 24h.
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
    'own_blocked_words', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', w.conversation_id, 'word', w.word, 'created_at', w.created_at)) from conversation_blocked_words w where w.user_id = p_uid), '[]'),
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
