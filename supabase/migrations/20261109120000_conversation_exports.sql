-- Court-oriented conversation export (79 DKK plan only). The PDF is built SERVER-SIDE by the
-- export-conversation Edge Function from database records and e-mailed; nothing is downloaded on
-- the device. This migration adds: the export register (verification record, minimal data),
-- rate limits, a service-only message reader with the same visibility rules as get_messages,
-- a public verification RPC (metadata only, never content) and a conversation event
-- ("X har lavet en udskrift af samtalen") shown to all members.

create table public.conversation_exports (
  id uuid primary key default gen_random_uuid(),
  verify_code text not null unique check (verify_code ~ '^[0-9A-F]{20}$'),   -- 80 random bits
  conversation_id uuid references public.conversations(id) on delete set null,
  exporter_id uuid references auth.users(id) on delete set null,
  recipient_kind text not null check (recipient_kind in ('self','other')),
  recipient_email text check (char_length(recipient_email) <= 254),           -- abuse log; never returned by verify
  period_from timestamptz, period_to timestamptz, partial boolean not null default false,
  message_count int check (message_count >= 0), page_count int check (page_count >= 1),
  pdf_sha256 text check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  check (period_from is null or period_to is null or period_from <= period_to)
);
create index conversation_exports_exporter on public.conversation_exports(exporter_id, created_at desc);
create index conversation_exports_sha on public.conversation_exports(pdf_sha256) where status = 'sent';
alter table public.conversation_exports enable row level security; -- no policies: only via functions
revoke all on public.conversation_exports from public, anon, authenticated;
grant select, insert, update on public.conversation_exports to service_role;

create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('export')),
  export_id uuid references public.conversation_exports(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index conversation_events_conv on public.conversation_events(conversation_id, created_at);
alter table public.conversation_events enable row level security;
revoke all on public.conversation_events from public, anon, authenticated;
grant select, insert, delete on public.conversation_events to service_role;

create table public.export_verify_attempts (ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'), created_at timestamptz not null default clock_timestamp());
create index export_verify_attempts_ip on public.export_verify_attempts(ip_hash, created_at);
alter table public.export_verify_attempts enable row level security;
revoke all on public.export_verify_attempts from public, anon, authenticated;
grant select, insert, delete on public.export_verify_attempts to service_role;

-- Start an export: membership, plan (authoritative, server side), recipient and rate limits.
-- Limits: 3 per hour, 10 per 24h, of which at most 5 to another address.
create function public.begin_conversation_export(p_uid uuid, conv uuid, p_from timestamptz, p_to timestamptz, p_kind text, p_email text)
returns table(export_id uuid, verify_code text, created_at timestamptz, recipient text, exporter_email text, partners text[], partial boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare me_email text; rcpt text; code text; row_id uuid; at timestamptz; part boolean;
begin
  if p_uid is null or not exists(select 1 from memberships m where m.conversation_id=conv and m.user_id=p_uid and m.left_at is null)
    then raise exception 'not_member' using errcode='42501'; end if;
  if _effective_plan(p_uid) <> 'text_attachments' then raise exception 'plan_required' using errcode='42501'; end if;
  if p_from is not null and p_to is not null and p_from > p_to then raise exception 'bad_period' using errcode='22023'; end if;
  select lower(u.email) into me_email from auth.users u where u.id=p_uid;
  if me_email is null then raise exception 'no_email' using errcode='22023'; end if;
  if p_kind = 'self' then rcpt := me_email;
  elsif p_kind = 'other' then
    rcpt := lower(btrim(coalesce(p_email,'')));
    if char_length(rcpt) > 254 or rcpt !~ '^[a-z0-9._%+''-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' or rcpt ~ '\.\.'
      then raise exception 'bad_email' using errcode='22023'; end if;
  else raise exception 'bad_input' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conversation_export:' || p_uid::text, 0));
  if (select count(*) from conversation_exports e where e.exporter_id=p_uid and e.status<>'failed' and e.created_at > now() - interval '1 hour') >= 3
    or (select count(*) from conversation_exports e where e.exporter_id=p_uid and e.status<>'failed' and e.created_at > now() - interval '24 hours') >= 10
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  if p_kind = 'other' and (select count(*) from conversation_exports e where e.exporter_id=p_uid and e.recipient_kind='other' and e.status<>'failed' and e.created_at > now() - interval '24 hours') >= 5
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  part := p_from is not null or p_to is not null;
  loop
    code := upper(encode(gen_random_bytes(10),'hex'));
    begin
      insert into conversation_exports(verify_code,conversation_id,exporter_id,recipient_kind,recipient_email,period_from,period_to,partial)
        values (code,conv,p_uid,p_kind,rcpt,p_from,p_to,part) returning id, conversation_exports.created_at into row_id, at;
      exit;
    exception when unique_violation then null; end;
  end loop;
  return query select row_id, code, at, rcpt, me_email,
    coalesce((select array_agg(_label_for(p_uid, o.user_id) order by o.joined_at) from memberships o where o.conversation_id=conv and o.left_at is null and o.user_id<>p_uid), '{}'::text[]),
    part;
end $$;
revoke execute on function public.begin_conversation_export(uuid,uuid,timestamptz,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.begin_conversation_export(uuid,uuid,timestamptz,timestamptz,text,text) to service_role;

-- Messages for the export: exactly the get_messages visibility rules (active membership, joined_at,
-- caller retention, own or released delivery), without the 500 cap, optionally limited to a period.
-- Attachment CONTENT is never returned, only name/type/size/SHA-256.
create function public.get_export_messages(p_uid uuid, conv uuid, p_from timestamptz, p_to timestamptz)
returns table(id uuid, sender_label text, sender_email text, sender_deleted boolean, mine boolean, body text, created_at timestamptz,
  att_mime text, att_name text, att_size int, att_pages int, att_sha256 text, reply_to_id uuid, has_reply boolean, reply_visible boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
declare mem memberships; cut timestamptz;
begin
  select * into mem from memberships m where m.conversation_id=conv and m.user_id=p_uid and m.left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  cut := _retention_cutoff(p_uid);
  return query
    with visible as materialized (
      select msg.* from messages msg
      where msg.conversation_id=conv and msg.created_at >= mem.joined_at and msg.created_at >= cut
        and (p_from is null or msg.created_at >= p_from) and (p_to is null or msg.created_at <= p_to)
        and (msg.sender_id=p_uid or exists(select 1 from message_deliveries d where d.message_id=msg.id and d.recipient_id=p_uid and d.released_at is not null))
      order by msg.created_at, msg.id limit 5000)
    select v.id, case when v.sender_id is null then 'Slettet bruger' else _label_for(p_uid, v.sender_id) end, u.email::text, v.sender_id is null,
      coalesce(v.sender_id=p_uid,false), v.body, v.created_at, a.mime, a.name, a.size, a.pages,
      case when a.message_id is null then null else encode(digest(a.data,'sha256'),'hex') end,
      r.target_id, r.message_id is not null,
      (q.id is not null and q.created_at >= mem.joined_at and q.created_at >= cut
        and (q.sender_id=p_uid or exists(select 1 from message_deliveries d where d.message_id=q.id and d.recipient_id=p_uid and d.released_at is not null)))
    from visible v left join auth.users u on u.id=v.sender_id left join message_attachments a on a.message_id=v.id
      left join message_replies r on r.message_id=v.id left join messages q on q.id=r.target_id and q.conversation_id=conv
    order by v.created_at, v.id;
end $$;
revoke execute on function public.get_export_messages(uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.get_export_messages(uuid,uuid,timestamptz,timestamptz) to service_role;

-- Record the result. The SHA-256 is of the FINAL (signed) PDF bytes. A sent export creates the
-- conversation event that every member sees.
create function public.finish_conversation_export(p_id uuid, p_uid uuid, p_ok boolean, p_sha text, p_count int, p_pages int)
returns void language plpgsql security definer set search_path = public as $$
declare e conversation_exports;
begin
  select * into e from conversation_exports where id=p_id and exporter_id=p_uid and status='pending' for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if p_ok then
    if p_sha !~ '^[0-9a-f]{64}$' then raise exception 'bad_input' using errcode='22023'; end if;
    update conversation_exports set status='sent', pdf_sha256=p_sha, message_count=p_count, page_count=p_pages, finished_at=clock_timestamp() where id=p_id;
    insert into conversation_events(conversation_id, actor_id, kind, export_id) values (e.conversation_id, p_uid, 'export', p_id);
  else
    update conversation_exports set status='failed', finished_at=clock_timestamp() where id=p_id;
  end if;
end $$;
revoke execute on function public.finish_conversation_export(uuid,uuid,boolean,text,int,int) from public, anon, authenticated;
grant execute on function public.finish_conversation_export(uuid,uuid,boolean,text,int,int) to service_role;

-- Events shown in the conversation (same joined_at/retention rules as messages).
create function public.get_conversation_events(conv uuid)
returns table(id uuid, kind text, actor_label text, mine boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships;
begin
  select * into mem from memberships m where m.conversation_id=conv and m.user_id=me and m.left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  return query select ev.id, ev.kind, case when ev.actor_id is null then 'Slettet bruger' else _label_for(me, ev.actor_id) end,
      coalesce(ev.actor_id=me,false), ev.created_at
    from conversation_events ev where ev.conversation_id=conv and ev.created_at >= mem.joined_at and ev.created_at >= _retention_cutoff(me)
    order by ev.created_at, ev.id limit 500;
end $$;
revoke execute on function public.get_conversation_events(uuid) from public, anon;
grant execute on function public.get_conversation_events(uuid) to authenticated;

-- Public verification (via the verify-export Edge Function, which supplies a hashed IP).
-- Returns only status + export metadata, never content, names, e-mails or ids.
-- Limits: 20 checks per IP per 10 minutes. Codes have 80 random bits.
create function public.verify_conversation_export(p_ip_hash text, p_code text, p_sha text)
returns table(status text, created_at timestamptz, period_from timestamptz, period_to timestamptz, partial boolean, message_count int, page_count int)
language plpgsql security definer set search_path = public as $$
declare code text := upper(regexp_replace(coalesce(p_code,''), '[^0-9A-Fa-f]', '', 'g')); sha text := lower(btrim(coalesce(p_sha,''))); e conversation_exports;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_input' using errcode='22023'; end if;
  delete from export_verify_attempts where export_verify_attempts.created_at < now() - interval '1 day';
  if (select count(*) from export_verify_attempts a where a.ip_hash=p_ip_hash and a.created_at > now() - interval '10 minutes') >= 20
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into export_verify_attempts(ip_hash) values (p_ip_hash);
  if code !~ '^[0-9A-F]{20}$' then code := ''; end if;
  if sha !~ '^[0-9a-f]{64}$' then sha := ''; end if;
  if code = '' and sha = '' then raise exception 'bad_input' using errcode='22023'; end if;
  if sha <> '' then
    select * into e from conversation_exports x where x.status='sent' and x.pdf_sha256=sha and (code='' or x.verify_code=code) limit 1;
    if found then return query select 'match'::text, e.created_at, e.period_from, e.period_to, e.partial, e.message_count, e.page_count; return; end if;
    return query select 'mismatch'::text, null::timestamptz, null::timestamptz, null::timestamptz, null::boolean, null::int, null::int; return;
  end if;
  select * into e from conversation_exports x where x.status='sent' and x.verify_code=code;
  if found then return query select 'code_valid'::text, e.created_at, e.period_from, e.period_to, e.partial, e.message_count, e.page_count; return; end if;
  return query select 'mismatch'::text, null::timestamptz, null::timestamptz, null::timestamptz, null::boolean, null::int, null::int;
end $$;
revoke execute on function public.verify_conversation_export(text,text,text) from public, anon, authenticated;
grant execute on function public.verify_conversation_export(text,text,text) to service_role;

-- The register is written BEFORE the mail is sent (so every delivered PDF is verifiable). If the
-- mail then fails, the export is marked failed and its conversation event removed.
create function public.mark_conversation_export_failed(p_id uuid, p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update conversation_exports set status='failed', finished_at=clock_timestamp() where id=p_id and exporter_id=p_uid and status in ('pending','sent');
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  delete from conversation_events where export_id=p_id;
end $$;
revoke execute on function public.mark_conversation_export_failed(uuid,uuid) from public, anon, authenticated;
grant execute on function public.mark_conversation_export_failed(uuid,uuid) to service_role;
