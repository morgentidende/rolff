-- "X accepted your invitation" push to the inviter.
--
--  * When an invitation is accepted, the inviter (invitations.created_by) gets ONE neutral notification job
--    (kind 'invite_accepted') if - and only if - they have notifications switched on. It reuses the existing
--    pipeline unchanged: claim_push_work -> prepare_push -> handoff_push -> finish_push, the same lease/handoff
--    fences, the same 24-hour lifetime, the same kill switch.
--  * Text (built in the service worker from the payload below): title "<nickname or e-mail> har accepteret din
--    invitation" / body "Nu kan I chatte på Rolff." (English: "<name> accepted your invitation" / "You can now
--    chat on Rolff."). The name is the INVITER's OWN private nickname for the person who accepted (also one set while
--    the invitation was pending, which PR95 copies into contact_aliases on accept), otherwise that person's e-mail
--    address, shortened and cleaned exactly like PR93 (push_notice_who). No name at all -> generic text.
--  * Rules (decided here, documented in docs/web-push.md):
--      - Lydløs (mute) of that conversation: no notification. Checked at send time, so muting before the
--        notification went out silences it, and a job that finds the chat muted is closed (never fires later).
--      - Receive times: the notification waits until the inviter's receive window for THAT conversation is open
--        (same per-conversation check as for messages), for at most the usual 24 hours, then it is dropped.
--      - Opt-in: checked when the job is created, again when it is claimed and again when it is prepared.
--      - The inviter must still be a member, and so must the person who accepted.
--      - Only the inviter is notified. The person who accepted learns nothing and no read or delivery status of
--        any message is involved: the payload holds a conversation id and a name, never message data.
--  * Tapping the notification opens that conversation: the payload carries the conversation id (uuid, validated
--    by the service worker, which builds the same-origin URL itself; the app only opens it if the user is a member).

alter table public.notification_jobs
  add column kind text not null default 'messages' check (kind in ('messages','invite_accepted')),
  add column conversation_id uuid references public.conversations(id) on delete cascade,
  add column subject_id uuid references auth.users(id) on delete cascade,
  add column invitation_id uuid references public.invitations(id) on delete cascade,
  add constraint notification_jobs_kind_shape check (
    (kind = 'messages' and conversation_id is null and subject_id is null and invitation_id is null)
    or (kind = 'invite_accepted' and conversation_id is not null and subject_id is not null and invitation_id is not null));
create unique index notification_jobs_invite_once on public.notification_jobs(invitation_id) where invitation_id is not null;

-- One job per accepted invitation, for the inviter only, only with notifications on.
create function public._invite_accepted_push() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.accepted_at is not null and old.accepted_at is null and new.accepted_by is not null
     and new.accepted_by <> new.created_by
     and exists(select 1 from public.push_preferences p where p.user_id = new.created_by and p.enabled)
     and public.is_active_member(new.conversation_id, new.created_by) then
    insert into public.notification_jobs(user_id, kind, conversation_id, subject_id, invitation_id)
      values (new.created_by, 'invite_accepted', new.conversation_id, new.accepted_by, new.id)
      on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public._invite_accepted_push() from public, anon, authenticated;
create trigger invitation_accepted_push after update of accepted_at on public.invitations
  for each row execute function public._invite_accepted_push();

-- Payload fields for the notification: the conversation and the display name (never anything else).
create function public.push_accept_notice(uid uuid, p_job bigint) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs; nick text; mail text; nm text;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid and kind = 'invite_accepted';
  if not found then return null; end if;
  select nullif(btrim(regexp_replace(coalesce(a.alias, ''), '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g')), ''),
         nullif(btrim(regexp_replace(coalesce(public._push_short_email(u.email::text), ''), '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g')), '')
    into nick, mail
  from auth.users u left join public.contact_aliases a on a.owner_id = uid and a.contact_user_id = u.id
  where u.id = j.subject_id;
  nm := left(coalesce(nick, mail), 40);
  return jsonb_build_object('c', j.conversation_id, 's', case when nm is null or nm = '' then null else to_jsonb(nm) end);
end $$;
revoke all on function public.push_accept_notice(uuid, bigint) from public, anon, authenticated;
grant execute on function public.push_accept_notice(uuid, bigint) to service_role;

-- True when this job must not produce a push any more. Messages: every released conversation is muted
-- (unchanged). Invitation accepted: the conversation is muted for the inviter, or either person left it.
create function public.notification_job_suppressed(uid uuid, p_job bigint, at timestamptz) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return false; end if;
  if j.kind = 'invite_accepted' then
    return public.conversation_is_muted(uid, j.conversation_id, at)
        or not public.is_active_member(j.conversation_id, uid)
        or not public.is_active_member(j.conversation_id, j.subject_id);
  end if;
  return public.notification_job_all_muted(uid, p_job, at);
end $$;
revoke all on function public.notification_job_suppressed(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.notification_job_suppressed(uuid, bigint, timestamptz) to service_role;

-- Receive times: an acceptance notice follows the receive window of its own conversation.
create or replace function public.notification_in_receive_window(uid uuid, at timestamptz, p_job bigint)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs; n int; ok int;
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return false; end if;
  if j.kind = 'invite_accepted' then return public.in_receive_window(uid, at, j.conversation_id); end if;
  select count(distinct m.conversation_id),
         count(distinct m.conversation_id) filter (where public.in_receive_window(uid, at, m.conversation_id))
    into n, ok
  from public.message_deliveries d
  join public.messages m on m.id = d.message_id
  where d.recipient_id = uid and d.released_at is not null
    and d.released_at >= j.created_at - interval '1 second';
  if coalesce(n, 0) = 0 then
    return public.in_receive_window(uid, at);
  end if;
  return ok = n;
end $$;

-- Claiming closes jobs that are suppressed (see above) instead of the old "all muted" test.
create or replace function public.claim_push_work() returns table(job_id bigint,subscription_id uuid,lease uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.push_subscriptions where expires_at<=clock_timestamp();
 delete from public.notification_jobs where created_at<clock_timestamp()-interval '7 days';
 delete from public.conversation_mutes where mute_until is not null and mute_until<clock_timestamp()-interval '7 days';
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and
 (j.created_at<clock_timestamp()-interval '24 hours' or not exists(select 1 from public.push_preferences p where p.user_id=j.user_id and p.enabled)
  or public.notification_job_suppressed(j.user_id,j.id,clock_timestamp()));
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) then return; end if;
 with batch as (select id from public.notification_jobs where completed_at is null and prepared_at is null order by id for update skip locked limit 100),
 jobs as (update public.notification_jobs j set prepared_at=clock_timestamp() from batch b where b.id=j.id returning j.*)
 insert into public.push_attempts(job_id,subscription_id)
 select j.id,s.id from jobs j join public.push_subscriptions s on s.user_id=j.user_id
 where s.created_at<=j.created_at and s.expires_at>clock_timestamp() on conflict do nothing;
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and j.prepared_at is not null and not exists(select 1 from public.push_attempts a where a.job_id=j.id and a.done_at is null);
 return query
 with candidates as (
  select a.job_id,a.subscription_id from public.push_attempts a join public.notification_jobs j on j.id=a.job_id
  where a.done_at is null and a.attempts<5 and a.next_at<=clock_timestamp() and (a.lease_until is null or a.lease_until<clock_timestamp())
   and j.completed_at is null and public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id)
  order by a.job_id,a.subscription_id for update of a skip locked limit 10
 ), claimed as (
 update public.push_attempts a set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',attempts=a.attempts+1,handoff_id=null
 from candidates c where a.job_id=c.job_id and a.subscription_id=c.subscription_id returning a.job_id,a.subscription_id,a.lease
 ) select * from claimed;
end $$;


revoke all on function public.claim_push_work() from public,anon,authenticated;
grant execute on function public.claim_push_work() to service_role;

-- prepare_push: same as before, but the "released messages" proof only applies to message jobs; an acceptance
-- notice carries 'accept' (conversation id + name) instead of 'who'. Message jobs return exactly the same keys as before.

create or replace function public.prepare_push(p_job bigint,p_sub uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.push_attempts; j public.notification_jobs; s public.push_subscriptions;
begin
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease and done_at is null and lease_until>clock_timestamp();
 if not found then return null; end if;
 select * into j from public.notification_jobs where id=p_job and completed_at is null and created_at>clock_timestamp()-interval '24 hours';
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||j.user_id::text,0)) then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:push:'||j.user_id::text,0)) then return null; end if;
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) or not exists(select 1 from public.push_preferences where user_id=j.user_id and enabled) or not public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id) or public.notification_job_suppressed(j.user_id,j.id,clock_timestamp()) then return null; end if;
 if j.kind='messages' and not exists(select 1 from public.message_deliveries where recipient_id=j.user_id and released_at is not null and released_at>=j.created_at-interval '1 second') then return null; end if;
 select * into s from public.push_subscriptions where id=p_sub and user_id=j.user_id and expires_at>clock_timestamp() and created_at<=j.created_at;
 if not found or not public._push_endpoint_ok(s.endpoint) then return null; end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.id,'lang',public.locale_of(j.user_id),'prepared_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 seconds')
  || case when j.kind='messages' then jsonb_build_object('who',public.push_notice_who(j.user_id,j.id,clock_timestamp()))
          else jsonb_build_object('accept',public.push_accept_notice(j.user_id,j.id)) end;
end $$;
revoke all on function public.prepare_push(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_push(bigint,uuid,uuid) to service_role;
