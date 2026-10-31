-- Rolff core schema. All sensitive mutations go through SECURITY DEFINER functions
-- that are only executable by service_role (Edge Functions). Clients get narrow
-- read RPCs. Every exposed table has RLS enabled.
create extension if not exists pgcrypto with schema extensions;

-- ---------- Profiles ----------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  locale text not null default 'da' check (locale in ('da','en')),
  theme text not null default 'system' check (theme in ('system','light','dark')),
  ai_consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Conversations & membership periods ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text check (char_length(title) <= 80),
  member_version int not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('parent','writer','reader');

-- One row per membership PERIOD. Rejoining creates a new period; history access
-- is bounded by joined_at..left_at.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  joined_at timestamptz not null default clock_timestamp(),
  left_at timestamptz
);
create unique index memberships_one_active on public.memberships(conversation_id,user_id) where left_at is null;

-- ---------- Invitations & consents ----------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  role public.member_role not null,
  token_hash bytea not null unique,
  member_version int not null,          -- consent is bound to this member set
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invitation_consents (
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_version int not null,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (invitation_id, user_id)
);

-- ---------- Messages ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (char_length(body) between 1 and 480),
  body_hash text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  created_at timestamptz not null default clock_timestamp(),
  unique (sender_id, idempotency_key)
);

-- Per-recipient delivery gate. released_at null = pending (invisible to recipient).
create table public.message_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  released_at timestamptz,
  primary key (message_id, recipient_id)
);
create index message_deliveries_pending on public.message_deliveries(recipient_id) where released_at is null;

-- ---------- Moderation approvals (single use, short lived) ----------
create table public.moderation_approvals (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body_hash text not null,
  provider text not null,
  model text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Content-free audit of moderation attempts (rate limiting, no text stored).
create table public.moderation_attempts (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  decision text not null check (decision in ('allow','block','error')),
  reason_code text,
  created_at timestamptz not null default now()
);
create index moderation_attempts_rate on public.moderation_attempts(sender_id, created_at);

-- ---------- Receive windows ----------
create table public.receive_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Copenhagen',
  enabled boolean not null default false
);
create table public.receive_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),     -- ISO: 1=Mon
  start_minute int not null check (start_minute between 0 and 1439),
  end_minute int not null check (end_minute between 0 and 1440),
  check (start_minute <> end_minute)
);

-- ---------- Content-free notification jobs ----------
create table public.notification_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0
);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.invitation_consents enable row level security;
alter table public.messages enable row level security;
alter table public.message_deliveries enable row level security;
alter table public.moderation_approvals enable row level security;
alter table public.moderation_attempts enable row level security;
alter table public.receive_settings enable row level security;
alter table public.receive_windows enable row level security;
alter table public.notification_jobs enable row level security;

-- Helper: is caller an active member?
create or replace function public.is_active_member(conv uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m where m.conversation_id=conv and m.user_id=uid and m.left_at is null)
$$;

create policy profiles_self_select on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_self_insert on public.profiles for insert to authenticated with check (user_id = auth.uid());

create policy conv_member_select on public.conversations for select to authenticated using (public.is_active_member(id, auth.uid()));
create policy memberships_member_select on public.memberships for select to authenticated using (public.is_active_member(conversation_id, auth.uid()));

create policy rs_self on public.receive_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy rw_self on public.receive_windows for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- messages, message_deliveries, invitations, consents, approvals, attempts,
-- notification_jobs: NO client policies. Access only through RPCs below.
revoke all on public.messages, public.message_deliveries, public.invitations, public.invitation_consents,
  public.moderation_approvals, public.moderation_attempts, public.notification_jobs from anon, authenticated;
revoke all on public.conversations, public.memberships from anon;
revoke insert, update, delete on public.conversations, public.memberships from authenticated;
revoke all on public.profiles, public.receive_settings, public.receive_windows from anon;

-- ---------- Receive window logic (server side, DST aware via tz database) ----------
create or replace function public.in_receive_window(uid uuid, at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s receive_settings; local_ts timestamp; dow int; mins int; prev_dow int;
begin
  select * into s from receive_settings where user_id = uid;
  if not found or not s.enabled then return true; end if;
  local_ts := at at time zone s.timezone;
  dow := extract(isodow from local_ts)::int;
  mins := extract(hour from local_ts)::int*60 + extract(minute from local_ts)::int;
  prev_dow := case when dow = 1 then 7 else dow - 1 end;
  return exists (
    select 1 from receive_windows w where w.user_id = uid and (
      (w.start_minute < w.end_minute and w.weekday = dow and mins >= w.start_minute and mins < w.end_minute)
      or (w.start_minute > w.end_minute and w.weekday = dow and mins >= w.start_minute)        -- overnight, first part
      or (w.start_minute > w.end_minute and w.weekday = prev_dow and mins < w.end_minute)      -- overnight, after midnight
    ));
end $$;

-- Releases pending deliveries for uid if inside window (or forced by "receive now").
create or replace function public._release_for(uid uuid, force boolean)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not force and not in_receive_window(uid) then return 0; end if;
  update message_deliveries set released_at = clock_timestamp()
   where recipient_id = uid and released_at is null;
  get diagnostics n = row_count;
  if n > 0 then insert into notification_jobs(user_id) values (uid); end if;
  return n;
end $$;

-- ---------- Client read RPCs ----------
create or replace function public.list_my_conversations()
returns table(id uuid, title text, role public.member_role, members int)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, m.role, (select count(*)::int from memberships x where x.conversation_id=c.id and x.left_at is null)
  from conversations c join memberships m on m.conversation_id=c.id and m.user_id=auth.uid() and m.left_at is null
  order by c.created_at desc
$$;

-- Returns only: own messages + released messages, never before own joined_at.
-- No delivery/read status is exposed to anyone.
create or replace function public.get_messages(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships;
begin
  select * into mem from memberships where conversation_id=conv and user_id=me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  perform _release_for(me, false);
  return query
    select msg.id, msg.sender_id, p.display_name, msg.body, msg.created_at, msg.sender_id = me
    from messages msg left join profiles p on p.user_id = msg.sender_id
    where msg.conversation_id = conv and msg.created_at >= mem.joined_at
      and (msg.sender_id = me or exists (select 1 from message_deliveries d
             where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
    order by msg.created_at asc limit 500;
end $$;

-- Pending count is shown ONLY to the recipient themself (never to sender).
create or replace function public.my_pending_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from message_deliveries where recipient_id = auth.uid() and released_at is null
$$;

create or replace function public.receive_now()
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  return _release_for(auth.uid(), true);
end $$;

create or replace function public.create_conversation(p_title text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  insert into conversations(title, created_by) values (nullif(trim(p_title),''), me) returning id into cid;
  insert into memberships(conversation_id,user_id,role) values (cid, me, 'parent');
  return cid;
end $$;

-- ---------- Invitations ----------
-- Returns raw token once; only its hash is stored.
create or replace function public.create_invitation(conv uuid, p_role public.member_role)
returns table(invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); c conversations; raw text; inv uuid; exp timestamptz := now() + interval '72 hours';
begin
  select * into c from conversations where id = conv for update;
  if not found or not exists(select 1 from memberships where conversation_id=conv and user_id=me and left_at is null and role='parent')
    then raise exception 'forbidden' using errcode='42501'; end if;
  if p_role = 'parent' and (select count(*) from memberships where conversation_id=conv and left_at is null and role='parent') >= 2
    then raise exception 'parents_full' using errcode='P0001'; end if;
  raw := encode(gen_random_bytes(24),'hex');
  insert into invitations(conversation_id, created_by, role, token_hash, member_version, expires_at)
    values (conv, me, p_role, digest(raw,'sha256'), c.member_version, exp) returning id into inv;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, me, c.member_version, p_role);
  return query select inv, raw, exp;
end $$;

create or replace function public.revoke_invitation(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update invitations i set revoked_at = now()
   where i.id = inv and i.accepted_at is null and i.revoked_at is null
     and exists(select 1 from memberships m where m.conversation_id=i.conversation_id and m.user_id=auth.uid() and m.left_at is null and m.role='parent');
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
end $$;

-- Existing parents consent to a specific invitation (role + member_version bound).
create or replace function public.consent_invitation(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i invitations; c conversations;
begin
  select * into i from invitations where id = inv;
  if not found or not exists(select 1 from memberships where conversation_id=i.conversation_id and user_id=auth.uid() and left_at is null and role='parent')
    then raise exception 'not_found' using errcode='P0002'; end if;
  select * into c from conversations where id = i.conversation_id;
  if c.member_version <> i.member_version then raise exception 'stale_invitation' using errcode='P0001'; end if;
  insert into invitation_consents(invitation_id,user_id,member_version,role) values (inv, auth.uid(), i.member_version, i.role)
    on conflict (invitation_id,user_id) do nothing;
end $$;

-- Pending invitations needing my consent (no private content).
create or replace function public.list_pending_invitations(conv uuid)
returns table(id uuid, role public.member_role, expires_at timestamptz, consents int, required int, i_consented boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.role, i.expires_at,
    (select count(*)::int from invitation_consents ic where ic.invitation_id=i.id and ic.member_version=i.member_version),
    (select count(*)::int from memberships m where m.conversation_id=i.conversation_id and m.left_at is null and m.role='parent'),
    exists(select 1 from invitation_consents ic where ic.invitation_id=i.id and ic.user_id=auth.uid())
  from invitations i join conversations c on c.id=i.conversation_id
  where i.conversation_id = conv and public.is_active_member(conv, auth.uid())
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and i.member_version = c.member_version
$$;

-- Accept: generic errors so token probing reveals nothing.
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); i invitations; c conversations; needed int; have int;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into i from invitations where token_hash = digest(p_token,'sha256') for update;
  if not found or i.revoked_at is not null or i.accepted_at is not null or i.expires_at <= now()
    then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  select * into c from conversations where id = i.conversation_id for update;
  if c.member_version <> i.member_version then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  if exists(select 1 from memberships where conversation_id=c.id and user_id=me and left_at is null)
    then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  -- Unanimous consent of all active parents, bound to this version and role.
  select count(*) into needed from memberships where conversation_id=c.id and left_at is null and role='parent';
  select count(*) into have from invitation_consents ic join memberships m
    on m.conversation_id=c.id and m.user_id=ic.user_id and m.left_at is null and m.role='parent'
    where ic.invitation_id=i.id and ic.member_version=c.member_version and ic.role=i.role;
  if have < needed then raise exception 'consent_missing' using errcode='P0001'; end if;
  if i.role='parent' and needed >= 2 then raise exception 'invalid_invitation' using errcode='P0001'; end if;
  update invitations set accepted_by=me, accepted_at=now() where id=i.id;
  insert into memberships(conversation_id,user_id,role) values (c.id, me, i.role);
  update conversations set member_version = member_version + 1 where id = c.id;
  return c.id;
end $$;

-- ---------- Send path (service_role only, called by Edge Function) ----------
-- Checks identity/membership/write right/length/rate and returns <=10 context
-- messages the SENDER is authorized to see.
create or replace function public.prepare_send(p_sender uuid, conv uuid, p_body text)
returns table(ctx_mine boolean, ctx_body text)
language plpgsql security definer set search_path = public as $$
declare mem memberships;
begin
  select * into mem from memberships where conversation_id=conv and user_id=p_sender and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  if mem.role = 'reader' then raise exception 'read_only' using errcode='42501'; end if;
  if char_length(p_body) < 1 or char_length(p_body) > 480 then raise exception 'length' using errcode='22001'; end if;
  if (select count(*) from moderation_attempts where sender_id=p_sender and created_at > now() - interval '1 minute') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  return query
    select x.mine, x.body from (
      select msg.sender_id = p_sender as mine, msg.body, msg.created_at
      from messages msg where msg.conversation_id=conv and msg.created_at >= mem.joined_at
        and (msg.sender_id=p_sender or exists(select 1 from message_deliveries d where d.message_id=msg.id and d.recipient_id=p_sender and d.released_at is not null))
      order by msg.created_at desc limit 10) x order by x.created_at asc;
end $$;

create or replace function public.record_attempt(p_sender uuid, conv uuid, p_decision text, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into moderation_attempts(sender_id,conversation_id,decision,reason_code) values (p_sender,conv,p_decision,p_reason)
$$;

create or replace function public.issue_approval(p_sender uuid, conv uuid, p_hash text, p_provider text, p_model text)
returns uuid language sql security definer set search_path = public as $$
  insert into moderation_approvals(sender_id,conversation_id,body_hash,provider,model,expires_at)
  values (p_sender,conv,p_hash,p_provider,p_model, now() + interval '60 seconds') returning id
$$;

-- Atomically consumes approval and stores message. Idempotent per (sender,key).
create or replace function public.commit_message(p_approval uuid, p_sender uuid, conv uuid, p_body text, p_key text)
returns table(message_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare existing uuid; h text := encode(digest(p_body,'sha256'),'hex'); mid uuid; ok uuid;
begin
  select id into existing from messages where sender_id=p_sender and idempotency_key=p_key;
  if found then return query select existing, true; return; end if;
  if not exists(select 1 from memberships where conversation_id=conv and user_id=p_sender and left_at is null and role <> 'reader')
    then raise exception 'not_member' using errcode='42501'; end if;
  update moderation_approvals set consumed_at = clock_timestamp()
   where id=p_approval and sender_id=p_sender and conversation_id=conv and body_hash=h
     and consumed_at is null and expires_at > now()
  returning id into ok;
  if ok is null then raise exception 'approval_invalid' using errcode='P0001'; end if;
  insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key) values (conv,p_sender,p_body,h,p_key) returning id into mid;
  insert into message_deliveries(message_id,recipient_id)
    select mid, m.user_id from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  -- Release immediately for recipients currently inside their window.
  perform _release_for(m.user_id, false) from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  return query select mid, false;
end $$;

-- ---------- Grants ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.list_my_conversations(), public.get_messages(uuid), public.my_pending_count(),
  public.receive_now(), public.create_conversation(text), public.create_invitation(uuid, public.member_role),
  public.revoke_invitation(uuid), public.consent_invitation(uuid), public.list_pending_invitations(uuid),
  public.accept_invitation(text), public.is_active_member(uuid,uuid) to authenticated;
grant execute on function public.prepare_send(uuid,uuid,text), public.record_attempt(uuid,uuid,text,text),
  public.issue_approval(uuid,uuid,text,text,text), public.commit_message(uuid,uuid,uuid,text,text) to service_role;

-- Auto profile on signup
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, display_name) values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), 'Bruger'))
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
