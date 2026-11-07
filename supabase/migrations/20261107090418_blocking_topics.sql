-- Private recipient topic preferences; no production data is reset by this migration.
create table public.conversation_blocked_topics (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 word text not null check(char_length(word) between 2 and 240),
 created_at timestamptz not null default clock_timestamp(),
 unique(conversation_id,user_id,word)
);
alter table public.conversation_blocked_topics enable row level security;
revoke all on public.conversation_blocked_topics from public,anon,authenticated;
grant select on public.conversation_blocked_topics to authenticated;
grant all on public.conversation_blocked_topics to service_role;
create policy cbt_own_select on public.conversation_blocked_topics for select to authenticated
 using(user_id=auth.uid() and public.is_active_member(conversation_id,auth.uid()));
create policy cbt_own_delete on public.conversation_blocked_topics for delete to authenticated
 using(user_id=auth.uid() and public.is_active_member(conversation_id,auth.uid()));

-- A per-conversation revision serializes list edits, membership changes and ticket consumption.
-- Revision is opaque text on the wire (avoid JS bigint precision loss). No private criteria in tickets.
create table public.conversation_filter_revision (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 revision bigint not null default 0
);
insert into public.conversation_filter_revision(conversation_id) select id from public.conversations;
revoke all on public.conversation_filter_revision from public,anon,authenticated;
alter table public.conversation_filter_revision enable row level security;
create function public._bump_filter_revision() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid;
begin
 c:=case when tg_op='DELETE' then old.conversation_id else new.conversation_id end;
 -- Cascade deletion of the conversation needs no revision.
 perform 1 from public.conversations where id=c for key share;
 if found then
  insert into public.conversation_filter_revision(conversation_id,revision) values(c,1)
   on conflict(conversation_id) do update set revision=conversation_filter_revision.revision+1;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public._bump_filter_revision() from public,anon,authenticated;
create trigger words_revision before insert or update or delete on public.conversation_blocked_words for each row execute function public._bump_filter_revision();
create trigger topics_revision before insert or update or delete on public.conversation_blocked_topics for each row execute function public._bump_filter_revision();
create trigger members_filter_revision before insert or update or delete on public.memberships for each row execute function public._bump_filter_revision();

create function public.add_blocked_topic(conv uuid,p_word text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=auth.uid(); w text:=regexp_replace(trim(coalesce(p_word,'')), '\s+', ' ', 'g'); result uuid;
begin
 if me is null or not public.is_active_member(conv,me) then raise exception 'not_member' using errcode='42501'; end if;
 -- Conversation-first lock order agrees with existing membership RPCs and message FKs.
 perform 1 from public.conversations where id=conv for key share;
 -- Lock before count to enforce the bound under concurrent adds.
 perform 1 from public.conversation_filter_revision where conversation_id=conv for update;
 if char_length(w) not between 2 and 240 then raise exception 'length'; end if;
 if (select count(*) from public.conversation_blocked_topics where conversation_id=conv and user_id=me)>=20 then raise exception 'too_many'; end if;
 insert into public.conversation_blocked_topics(conversation_id,user_id,word) values(conv,me,w)
 on conflict(conversation_id,user_id,word) do update set word=excluded.word returning id into result;
 return result;
end $$;
revoke all on function public.add_blocked_topic(uuid,text) from public,anon,authenticated;
grant execute on function public.add_blocked_topic(uuid,text) to authenticated;

-- All client removal paths lock conversation/revision BEFORE taking an entry tuple lock.
-- Direct DELETE takes its tuple lock before BEFORE triggers and can deadlock with a duplicate upsert.
revoke delete on public.conversation_blocked_words,public.conversation_blocked_topics from public,anon,authenticated;
create function public.remove_blocked_word(conv uuid,p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_active_member(conv,auth.uid()) then raise exception 'not_member' using errcode='42501'; end if;
 perform 1 from public.conversations where id=conv for key share;
 perform 1 from public.conversation_filter_revision where conversation_id=conv for update;
 delete from public.conversation_blocked_words where conversation_id=conv and user_id=auth.uid() and id=p_id;
end $$;
revoke all on function public.remove_blocked_word(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_blocked_word(uuid,uuid) to authenticated;

create function public.remove_blocked_topic(conv uuid,p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_active_member(conv,auth.uid()) then raise exception 'not_member' using errcode='42501'; end if;
 perform 1 from public.conversations where id=conv for key share;
 perform 1 from public.conversation_filter_revision where conversation_id=conv for update;
 delete from public.conversation_blocked_topics where conversation_id=conv and user_id=auth.uid() and id=p_id;
end $$;
revoke all on function public.remove_blocked_topic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_blocked_topic(uuid,uuid) to authenticated;

create function public.reset_blocked_words(conv uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_active_member(conv,auth.uid()) then raise exception 'not_member' using errcode='42501'; end if;
 perform 1 from public.conversations where id=conv for key share;
 perform 1 from public.conversation_filter_revision where conversation_id=conv for update;
 delete from public.conversation_blocked_words where conversation_id=conv and user_id=auth.uid();
end $$;
revoke all on function public.reset_blocked_words(uuid) from public,anon,authenticated;
grant execute on function public.reset_blocked_words(uuid) to authenticated;

-- One MVCC snapshot: the evaluated words/topics and their revision MUST be fetched together.
create function public.recipient_filter_snapshot(conv uuid,p_sender uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('revision',r.revision::text,
 'words',coalesce((select jsonb_agg(b.word order by b.id) from public.conversation_blocked_words b join public.memberships m on m.conversation_id=b.conversation_id and m.user_id=b.user_id and m.left_at is null where b.conversation_id=conv and b.user_id<>p_sender),'[]'::jsonb),
 'topics',coalesce((select jsonb_agg(b.word order by b.id) from public.conversation_blocked_topics b join public.memberships m on m.conversation_id=b.conversation_id and m.user_id=b.user_id and m.left_at is null where b.conversation_id=conv and b.user_id<>p_sender),'[]'::jsonb))
 from public.conversation_filter_revision r where r.conversation_id=conv and public.is_active_member(conv,p_sender)
$$;
revoke all on function public.recipient_filter_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recipient_filter_snapshot(uuid,uuid) to service_role;

alter table public.moderation_approvals add column filter_revision bigint;
-- Existing version constraint is retained: NULL filter_revision invalidates old v2 issuers too.
create function public.issue_reply_approval_v3(p_sender uuid,conv uuid,p_hash text,p_provider text,p_model text,p_revision text,p_reply uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_revision bigint; approval uuid;
begin
 perform 1 from public.conversations where id=conv for key share;
 select revision into current_revision from public.conversation_filter_revision where conversation_id=conv for update;
 if current_revision is null or p_revision is distinct from current_revision::text then raise exception 'recipient_policy_changed'; end if;
 approval:=public.issue_reply_approval_v2(p_sender,conv,p_hash,p_provider,p_model,p_reply);
 update public.moderation_approvals set filter_revision=current_revision where id=approval;
 return approval;
end $$;
revoke all on function public.issue_reply_approval_v3(uuid,uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_reply_approval_v3(uuid,uuid,text,text,text,text,uuid) to service_role;
create or replace function public._enforce_moderation_policy() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_revision bigint;
begin
 if old.consumed_at is null and new.consumed_at is not null then
  if old.policy_version<1 or old.filter_revision is null then raise exception 'approval_policy_outdated'; end if;
  perform 1 from public.conversations where id=old.conversation_id for key share;
  select revision into current_revision from public.conversation_filter_revision where conversation_id=old.conversation_id for update;
  if old.filter_revision is distinct from current_revision then raise exception 'recipient_policy_changed'; end if;
 end if;
 return new;
end $$;

-- Keep own topic criteria in owner-requested GDPR exports only.
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
