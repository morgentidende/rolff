-- LOCAL IMPLEMENTATION ONLY. No scheduling, secrets or opt-in enabled by this migration.
create table public.push_runtime (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 release_after uuid,
 vapid_public_key text check (vapid_public_key ~ '^B[A-Za-z0-9_-]{86}$')
);
insert into public.push_runtime(singleton) values(true);
create table public.push_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 offered_at timestamptz not null default clock_timestamp()
);
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique check(octet_length(endpoint) between 30 and 2048),
 p256dh text not null check(p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '90 days')
);
create index push_subscriptions_owner on public.push_subscriptions(user_id);
alter table public.push_runtime enable row level security;
alter table public.push_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
-- No client table access (including endpoints/keys). Narrow owner RPCs only.
revoke all on public.push_runtime,public.push_preferences,public.push_subscriptions from public,anon,authenticated;
grant all on public.push_runtime,public.push_preferences,public.push_subscriptions to service_role;

create function public._push_endpoint_ok(e text) returns boolean language sql immutable set search_path=pg_catalog as $$
 select e is not null and octet_length(e) between 30 and 2048 and e ~ '^https://(fcm[.]googleapis[.]com/fcm/send/|updates[.]push[.]services[.]mozilla[.]com/wpush/v[12]/|[a-z0-9-]+[.]push[.]apple[.]com/)[A-Za-z0-9_:/-]+$'
$$;
revoke all on function public._push_endpoint_ok(text) from public,anon,authenticated;

create function public.my_push_state() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=auth.uid(); r public.push_runtime;
begin
 if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 select * into r from public.push_runtime where singleton;
 return jsonb_build_object('available',r.enabled and r.vapid_public_key is not null,'public_key',case when r.enabled then r.vapid_public_key end,
  'offered',exists(select 1 from public.push_preferences where user_id=me),
  'enabled',coalesce((select enabled from public.push_preferences where user_id=me),false),
  'devices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'expires_at',expires_at) order by created_at) from public.push_subscriptions where user_id=me and expires_at>clock_timestamp()),'[]'::jsonb));
end $$;

create function public.decline_my_push() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 insert into public.push_preferences(user_id) values(auth.uid()) on conflict(user_id) do nothing;
end $$;

-- Renewal replaces the old binding, invalidating late pushes and old job attempts.
-- An endpoint owned by a different account can never be silently reassigned.
create function public.save_my_push(p_endpoint text,p_p256dh text,p_auth text,p_previous uuid default null) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=auth.uid(); result uuid;
begin
 if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rolff:push:'||me::text,0));
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) then raise exception 'push_unavailable' using errcode='55000'; end if;
 if not public._push_endpoint_ok(p_endpoint) or p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'invalid_subscription' using errcode='22023'; end if;
 if exists(select 1 from public.push_subscriptions where endpoint=p_endpoint and user_id<>me) then raise exception 'subscription_conflict' using errcode='23505'; end if;
 delete from public.push_subscriptions where user_id=me and (id=p_previous or endpoint=p_endpoint or expires_at<=clock_timestamp());
 if (select count(*) from public.push_subscriptions where user_id=me)>=8 then raise exception 'device_limit' using errcode='22023'; end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values(me,p_endpoint,p_p256dh,p_auth) returning id into result;
 insert into public.push_preferences(user_id,enabled) values(me,true) on conflict(user_id) do update set enabled=true;
 return result;
end $$;

create function public.revoke_my_push(p_id uuid default null,p_all boolean default false) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('rolff:push:'||me::text,0));
 delete from public.push_subscriptions where user_id=me and (p_all or id=p_id);
 if p_all or not exists(select 1 from public.push_subscriptions where user_id=me) then
  insert into public.push_preferences(user_id,enabled) values(me,false) on conflict(user_id) do update set enabled=false;
 end if;
end $$;

alter table public.notification_jobs add column completed_at timestamptz, add column prepared_at timestamptz;
-- Old jobs predate consent; do not send historical notifications at rollout.
update public.notification_jobs set completed_at=clock_timestamp();
create index notification_jobs_active on public.notification_jobs(id) where completed_at is null;
create table public.push_attempts (
 job_id bigint not null references public.notification_jobs(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 attempts int not null default 0 check(attempts between 0 and 5),
 next_at timestamptz not null default clock_timestamp(),
 lease uuid, lease_until timestamptz,
 done_at timestamptz,
 handoff_id uuid,
 primary key(job_id,subscription_id)
);
alter table public.push_attempts enable row level security;
revoke all on public.push_attempts from public,anon,authenticated;
grant all on public.push_attempts, public.notification_jobs to service_role;

-- Called by the same minute worker even when there are no open clients. Never force.
create function public.push_release_tick() returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid; n int:=0; cursor_id uuid; last_id uuid;
begin
 select release_after into cursor_id from public.push_runtime where singleton for update skip locked;
 if not found then return 0; end if;
 if not exists(select 1 from public.message_deliveries where released_at is null and (cursor_id is null or recipient_id>cursor_id)) then cursor_id:=null; end if;
 for u in select recipient_id from public.message_deliveries where released_at is null and (cursor_id is null or recipient_id>cursor_id) group by recipient_id order by recipient_id limit 100 loop
  last_id:=u;
  n:=n+public._release_for(u,false);
 end loop;
 update public.push_runtime set release_after=last_id where singleton;
 return n;
end $$;

-- Claim work atomically. SKIP LOCKED + unpredictable per-attempt lease fences stale workers.
create function public.claim_push_work() returns table(job_id bigint,subscription_id uuid,lease uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.push_subscriptions where expires_at<=clock_timestamp();
 delete from public.notification_jobs where created_at<clock_timestamp()-interval '7 days';
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and
 (j.created_at<clock_timestamp()-interval '24 hours' or not exists(select 1 from public.push_preferences p where p.user_id=j.user_id and p.enabled));
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) then return; end if;
 with batch as (select id from public.notification_jobs where completed_at is null and prepared_at is null order by id for update skip locked limit 100),
 jobs as (update public.notification_jobs j set prepared_at=clock_timestamp() from batch b where b.id=j.id returning j.*)
 insert into public.push_attempts(job_id,subscription_id)
 select j.id,s.id from jobs j join public.push_subscriptions s on s.user_id=j.user_id
 where s.created_at<=j.created_at and s.expires_at>clock_timestamp() on conflict do nothing;
 -- A job with zero subscriptions is finished, never retroactively sent to a new opt-in.
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and j.prepared_at is not null and not exists(select 1 from public.push_attempts a where a.job_id=j.id and a.done_at is null);
 return query
 with candidates as (
  select a.job_id,a.subscription_id from public.push_attempts a join public.notification_jobs j on j.id=a.job_id
  where a.done_at is null and a.attempts<5 and a.next_at<=clock_timestamp() and (a.lease_until is null or a.lease_until<clock_timestamp())
   and j.completed_at is null and public.in_receive_window(j.user_id,clock_timestamp())
  order by a.job_id,a.subscription_id for update of a skip locked limit 10
 ), claimed as (
 update public.push_attempts a set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',attempts=a.attempts+1,handoff_id=null
 from candidates c where a.job_id=c.job_id and a.subscription_id=c.subscription_id returning a.job_id,a.subscription_id,a.lease
 ) select * from claimed;
 -- Exhausted leases become terminal even when a worker crashed on its last attempt.
end $$;

-- PRE-FLIGHT ONLY: capabilities for encryption, NOT authorization to send.
-- The one-use handoff_push transaction below is mandatory before transport.
create function public.prepare_push(p_job bigint,p_sub uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.push_attempts; j public.notification_jobs; s public.push_subscriptions;
begin
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease and done_at is null and lease_until>clock_timestamp();
 if not found then return null; end if;
 select * into j from public.notification_jobs where id=p_job and completed_at is null and created_at>clock_timestamp()-interval '24 hours';
 if not found then return null; end if;
 -- Do not wait behind a receive-settings writer. No release side effects.
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||j.user_id::text,0)) then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:push:'||j.user_id::text,0)) then return null; end if;
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) or not exists(select 1 from public.push_preferences where user_id=j.user_id and enabled) or not public.in_receive_window(j.user_id,clock_timestamp()) then return null; end if;
 -- Only actual release-created jobs; require at least one still-existing released delivery.
 if not exists(select 1 from public.message_deliveries where recipient_id=j.user_id and released_at is not null and released_at>=j.created_at-interval '1 second') then return null; end if;
 select * into s from public.push_subscriptions where id=p_sub and user_id=j.user_id and expires_at>clock_timestamp() and created_at<=j.created_at;
 if not found or not public._push_endpoint_ok(s.endpoint) then return null; end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.id,'prepared_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 seconds');
end $$;

-- Explicit content-free one-use dispatch intents. No endpoint or key copies.
-- Retained even if a subscription is revoked while an already-committed intent is in flight.
create table public.push_handoffs (
 id uuid primary key default gen_random_uuid(),
 job_id bigint not null references public.notification_jobs(id) on delete cascade,
 subscription_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 lease uuid not null,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 intent_at timestamptz not null,
 valid_until timestamptz not null,
 outcome text not null default 'intent' check(outcome in ('intent','accepted','gone','permanent','retry','expired','unknown')),
 finished_at timestamptz,
 unique(job_id,subscription_id,lease)
);
alter table public.push_handoffs enable row level security;
revoke all on public.push_handoffs from public,anon,authenticated;
grant all on public.push_handoffs to service_role;

-- LINEARIZATION: commit of this one-use intent, serialized against current settings
-- and subscription/opt-out mutations by their existing exclusive advisory locks.
-- Neither a claim nor prepare is an intent. Intent is NOT proof of a physical POST.
create function public.handoff_push(p_job bigint,p_sub uuid,p_lease uuid,p_request_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid; a public.push_attempts; proof jsonb; at_time timestamptz; deadline timestamptz; result uuid;
begin
 if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request_hash' using errcode='22023'; end if;
 select user_id into uid from public.notification_jobs where id=p_job and completed_at is null;
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||uid::text,0)) then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:push:'||uid::text,0)) then return null; end if;
 -- Runtime kill-switch writes also serialize. Do not wait on them.
 begin perform 1 from public.push_runtime where singleton for share nowait;
 exception when lock_not_available then return null; end;
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease
  and done_at is null and handoff_id is null and lease_until>clock_timestamp() for update skip locked;
 if not found then return null; end if;
 proof:=public.prepare_push(p_job,p_sub,p_lease);
 if proof is null then return null; end if;
 at_time:=clock_timestamp();
 if not public.in_receive_window(uid,at_time) then return null; end if;
 -- At most 750ms; clip to next receive-window minute boundary using DB-relative time.
 deadline:=least(at_time+interval '750 milliseconds',date_trunc('minute',at_time)+interval '1 minute');
 insert into public.push_handoffs(job_id,subscription_id,user_id,lease,request_hash,intent_at,valid_until)
 values(p_job,p_sub,uid,p_lease,p_request_hash,at_time,deadline) returning id into result;
 update public.push_attempts set handoff_id=result where job_id=p_job and subscription_id=p_sub;
 return jsonb_build_object('id',result,'valid_for_ms',floor(extract(epoch from deadline-at_time)*1000)::int);
end $$;

create function public.finish_push(p_job bigint,p_sub uuid,p_lease uuid,p_outcome text,p_handoff uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.push_attempts;
begin
 if p_outcome not in ('accepted','gone','permanent','retry','deferred','expired') or p_outcome is null then raise exception 'invalid_outcome'; end if;
 -- "sent_at" is provider acceptance, never merely an intent or local queue entry.
 if p_outcome in ('accepted','gone') and p_handoff is null then return; end if;
 if p_handoff is not null then
  update public.push_handoffs set outcome=case when p_outcome='deferred' then 'expired' else p_outcome end,finished_at=clock_timestamp()
   where id=p_handoff and job_id=p_job and subscription_id=p_sub and lease=p_lease and outcome='intent';
  if not found then return; end if;
 end if;
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease
  and handoff_id is not distinct from p_handoff and lease_until>clock_timestamp() and done_at is null for update;
 if not found then return; end if;
 if p_outcome='gone' then delete from public.push_subscriptions where id=p_sub; return; end if;
 update public.push_attempts set done_at=case when p_outcome in ('accepted','permanent') or attempts>=5 then clock_timestamp() else null end,
 next_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts)::int)),lease=null,lease_until=null where job_id=p_job and subscription_id=p_sub;
 if p_outcome='accepted' then update public.notification_jobs set sent_at=clock_timestamp() where id=p_job; end if;
end $$;

create function public.cleanup_push_work() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.push_handoffs set outcome='unknown',finished_at=clock_timestamp() where outcome='intent' and valid_until<clock_timestamp()-interval '90 seconds';
 update public.push_attempts set done_at=clock_timestamp(),lease=null,lease_until=null where done_at is null and attempts>=5 and (lease_until is null or lease_until<clock_timestamp());
 update public.notification_jobs j set completed_at=clock_timestamp() where j.completed_at is null and exists(select 1 from public.push_attempts a where a.job_id=j.id) and not exists(select 1 from public.push_attempts a where a.job_id=j.id and a.done_at is null);
end $$;

revoke all on function public.my_push_state(),public.decline_my_push(),public.save_my_push(text,text,text,uuid),public.revoke_my_push(uuid,boolean) from public,anon;
grant execute on function public.my_push_state(),public.decline_my_push(),public.save_my_push(text,text,text,uuid),public.revoke_my_push(uuid,boolean) to authenticated;
revoke all on function public.push_release_tick(),public.claim_push_work(),public.prepare_push(bigint,uuid,uuid),public.handoff_push(bigint,uuid,uuid,text),public.finish_push(bigint,uuid,uuid,text,uuid),public.cleanup_push_work() from public,anon,authenticated;
grant execute on function public.push_release_tick(),public.claim_push_work(),public.prepare_push(bigint,uuid,uuid),public.handoff_push(bigint,uuid,uuid,text),public.finish_push(bigint,uuid,uuid,text,uuid),public.cleanup_push_work() to service_role;
