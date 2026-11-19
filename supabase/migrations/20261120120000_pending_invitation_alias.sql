-- Private nickname for a PENDING invitation ("Kontaktens kaldenavn" before the other person accepted).
--
--  * invitation_aliases: one private nickname per (invitation, owner). Owner-only (RLS + no write grants);
--    the invitee can never read it: the only invitee-facing read, peek_invitation(), is untouched and
--    returns neither this table nor any nickname.
--  * set_invitation_alias(): set / change / clear (blank) it while the invitation is still pending.
--    Allowed for any active member of the conversation (same rule as set_contact_alias: every member keeps
--    their OWN private nickname).
--  * When the invitation is accepted, a trigger copies each owner's nickname into contact_aliases
--    (owner -> the person who accepted). From then on it is an ordinary contact nickname, so the
--    conversation list, the chat header and the push-notification name (PR93: recipient's own nickname,
--    e-mail as fallback) all use it with no further code. A revoked/declined invitation drops its nicknames.
--  * list_my_conversations() / _v2() additionally return pending_invitation_id + pending_alias (the
--    caller's own), so a row that still waits for acceptance can show and edit the nickname.
--  * The data export lists the caller's own pending nicknames ('private_nickname' on invitations_created).

create table public.invitation_aliases (
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 40 and alias !~ '[\r\n]'),
  updated_at timestamptz not null default now(),
  primary key (invitation_id, owner_id)
);
create index invitation_aliases_owner_idx on public.invitation_aliases(owner_id);
alter table public.invitation_aliases enable row level security;
create policy invitation_aliases_owner_all on public.invitation_aliases for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.invitation_aliases from public, anon, authenticated;
grant select on public.invitation_aliases to authenticated;      -- writes only through set_invitation_alias()
grant all on public.invitation_aliases to service_role;

create or replace function public.set_invitation_alias(p_invitation uuid, p_alias text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a text := nullif(trim(coalesce(p_alias,'')), ''); i invitations; c conversations;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into i from invitations where id = p_invitation for share;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() - interval '30 days'
    or not public.is_active_member(i.conversation_id, me) then raise exception 'not_found' using errcode='P0002'; end if;
  select * into c from conversations where id = i.conversation_id;
  if c.member_version <> i.member_version then raise exception 'not_found' using errcode='P0002'; end if;
  if a is null then delete from invitation_aliases where invitation_id = p_invitation and owner_id = me; return; end if;
  if char_length(a) > 40 or a ~ '[\r\n]' then raise exception 'bad_alias' using errcode='22023'; end if;
  insert into invitation_aliases(invitation_id, owner_id, alias) values (p_invitation, me, a)
    on conflict (invitation_id, owner_id) do update set alias = excluded.alias, updated_at = now();
end $$;
revoke execute on function public.set_invitation_alias(uuid, text) from public, anon, authenticated;
grant execute on function public.set_invitation_alias(uuid, text) to authenticated;

-- Acceptance -> contact_aliases; revoke/decline -> forget. Runs in the same transaction as accept_invitation().
create or replace function public._invitation_alias_settle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.accepted_at is not null and old.accepted_at is null and new.accepted_by is not null then
    insert into contact_aliases(owner_id, contact_user_id, alias)
      select ia.owner_id, new.accepted_by, ia.alias from invitation_aliases ia
       where ia.invitation_id = new.id and ia.owner_id <> new.accepted_by
      on conflict (owner_id, contact_user_id) do update set alias = excluded.alias, updated_at = now();
    delete from invitation_aliases where invitation_id = new.id;
  elsif new.revoked_at is not null and old.revoked_at is null then
    delete from invitation_aliases where invitation_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public._invitation_alias_settle() from public, anon, authenticated;
create trigger invitation_alias_settle after update of accepted_at, revoked_at on public.invitations
  for each row execute function public._invitation_alias_settle();

-- Conversation list: same as before plus the caller's own nickname for the still-pending invitation.
drop function public.list_my_conversations_v2();
drop function public.list_my_conversations();
create function public.list_my_conversations()
returns table(id uuid, role public.member_role, members int, others jsonb, color text, pending_invitee text,
  pending_invitation_id uuid, pending_alias text)
language sql stable security definer set search_path = public as $$
  select c.id, m.role,
    (select count(*)::int from memberships x where x.conversation_id=c.id and x.left_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'email', _public_label(o.user_id),
        'alias', (select alias from contact_aliases a where a.owner_id = auth.uid() and a.contact_user_id = o.user_id)) order by o.joined_at)
      from memberships o
      where o.conversation_id = c.id and o.left_at is null and o.user_id <> auth.uid()), '[]'::jsonb),
    (select p.color from conversation_prefs p where p.user_id = auth.uid() and p.conversation_id = c.id),
    (select i.invitee_email from invitations i
      where i.conversation_id = c.id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at > now() and i.member_version = c.member_version
        and i.invitee_email is not null
      order by i.created_at desc limit 1),
    pi.id,
    (select ia.alias from invitation_aliases ia where ia.invitation_id = pi.id and ia.owner_id = auth.uid())
  from conversations c join memberships m on m.conversation_id=c.id and m.user_id=auth.uid() and m.left_at is null
  left join lateral (
    -- the invitation this row is waiting for: the same one pending_invitee comes from when it is live,
    -- otherwise the newest one that can still be renewed (expired < 30 days), as in list_pending_invitations()
    select i.id from invitations i
     where i.conversation_id = c.id and i.accepted_at is null and i.revoked_at is null
       and i.member_version = c.member_version and i.expires_at > now() - interval '30 days'
       and not exists (select 1 from memberships o where o.conversation_id = c.id and o.left_at is null and o.user_id <> auth.uid())
     order by (i.expires_at > now() and i.invitee_email is not null) desc, i.created_at desc limit 1
  ) pi on true
  order by c.created_at desc
$$;
revoke execute on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;

create function public.list_my_conversations_v2()
returns table(id uuid, role public.member_role, members int, others jsonb, color text, pending_invitee text,
  last_at timestamptz, last_body text, last_mine boolean, last_sender_name text, last_att_mime text,
  pending_invitation_id uuid, pending_alias text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); cut timestamptz;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  perform public._release_for(me, false);
  cut := public._retention_cutoff(me);
  return query
    select l.id, l.role, l.members, l.others, l.color, l.pending_invitee,
      lm.created_at, lm.preview, lm.mine, lm.sender_name, lm.att_mime,
      l.pending_invitation_id, l.pending_alias
    from public.list_my_conversations() l
    join public.conversations c on c.id = l.id
    join public.memberships mem on mem.conversation_id = l.id and mem.user_id = me and mem.left_at is null
    left join lateral (
      select msg.created_at,
        case when a.message_id is not null and msg.body = 'Vedhæftning: ' || a.name then null
             else left(msg.body, 120) end as preview,
        coalesce(msg.sender_id = me, false) as mine,
        case when msg.sender_id is null then 'Slettet bruger'
             when msg.sender_id = me then null
             else public._label_for(me, msg.sender_id) end as sender_name,
        a.mime as att_mime
      from public.messages msg left join public.message_attachments a on a.message_id = msg.id
      where msg.conversation_id = l.id and msg.created_at >= mem.joined_at and msg.created_at >= cut
        and (msg.sender_id = me or exists (select 1 from public.message_deliveries d
               where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
      order by msg.created_at desc, msg.id desc
      limit 1
    ) lm on true
    order by coalesce(lm.created_at, c.created_at) desc, l.id;
end $$;
revoke execute on function public.list_my_conversations_v2() from public, anon;
grant execute on function public.list_my_conversations_v2() to authenticated;

-- Data export: same as before, plus the caller's own pending-invitation nickname.
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
