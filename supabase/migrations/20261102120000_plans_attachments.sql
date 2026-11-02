-- Plans (per user) + moderated attachments.
-- Plan is per USER (the sender's capability), not per conversation: two parents may have
-- different plans. Sending an attachment requires the SENDER to be on 'text_attachments'.
-- Receiving/reading attachments never requires a plan (readers included).
-- Switching is a TEST FEATURE without payment, behind app_flags.plan_test_switch.
create table if not exists public.app_flags (key text primary key, value boolean not null);
alter table public.app_flags enable row level security;
insert into public.app_flags values ('plan_test_switch', true) on conflict (key) do nothing;

create table public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'text' check (plan in ('text','text_attachments')),
  pending_plan text check (pending_plan in ('text','text_attachments')),
  period_start timestamptz not null default now(),
  period_end timestamptz not null default now() + interval '1 month',
  source text not null default 'test' check (source in ('test')),
  updated_at timestamptz not null default now()
);
alter table public.user_plans enable row level security;
create policy user_plans_own on public.user_plans for select to authenticated using (user_id = auth.uid());

-- Applies a scheduled downgrade once the period has ended; rolls the period forward.
create or replace function public._effective_plan(uid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p user_plans;
begin
  select * into p from user_plans where user_id = uid for update;
  if not found then return 'text'; end if;
  if p.period_end <= now() then
    update user_plans set plan = coalesce(pending_plan, plan), pending_plan = null,
      period_start = now(), period_end = now() + interval '1 month', updated_at = now()
      where user_id = uid returning * into p;
  end if;
  return p.plan;
end $$;
revoke execute on function public._effective_plan(uuid) from public, anon, authenticated;
grant execute on function public._effective_plan(uuid) to service_role;

create or replace function public.get_my_plan()
returns table(plan text, pending_plan text, period_end timestamptz, test_switch boolean)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); eff text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  eff := _effective_plan(me);
  return query select eff, p.pending_plan, p.period_end, coalesce((select value from app_flags where key='plan_test_switch'), false)
    from (select 1) d left join user_plans p on p.user_id = me;
end $$;

-- Rule: upgrade applies immediately (new period starts now); downgrade applies from the next
-- period. Choosing the current plan cancels a scheduled change. p_now (TEST ONLY) applies a
-- downgrade immediately so it can be tested; allowed only while the test flag is on.
create or replace function public.set_my_plan_test(p_plan text, p_now boolean default false)
returns table(plan text, pending_plan text, period_end timestamptz)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if not coalesce((select value from app_flags where key='plan_test_switch'), false) then raise exception 'plan_switch_disabled' using errcode='42501'; end if;
  if p_plan not in ('text','text_attachments') then raise exception 'bad_plan' using errcode='22023'; end if;
  insert into user_plans(user_id) values (me) on conflict (user_id) do nothing;
  cur := _effective_plan(me);
  if p_plan = cur then
    update user_plans set pending_plan = null, updated_at = now() where user_id = me;
  elsif p_plan = 'text_attachments' or p_now then
    update user_plans set plan = p_plan, pending_plan = null, period_start = now(), period_end = now() + interval '1 month', updated_at = now() where user_id = me;
  else
    update user_plans set pending_plan = p_plan, updated_at = now() where user_id = me;
  end if;
  return query select u.plan, u.pending_plan, u.period_end from user_plans u where u.user_id = me;
end $$;
revoke execute on function public.get_my_plan(), public.set_my_plan_test(text, boolean) from public, anon;
grant execute on function public.get_my_plan(), public.set_my_plan_test(text, boolean) to authenticated;

-- Attachments live in the database next to the message, so deletion, retention, account
-- deletion (counterpart keeps their copy) and conversation cascade apply unchanged.
create table public.message_attachments (
  message_id uuid primary key references public.messages(id) on delete cascade,
  mime text not null check (mime in ('image/png','image/jpeg','image/webp','image/gif','application/pdf')),
  name text not null check (char_length(name) between 1 and 120),
  alt text check (char_length(alt) <= 300),
  size int not null check (size between 1 and 4194304),
  pages int check (pages between 1 and 5),
  data bytea not null
);
alter table public.message_attachments enable row level security; -- no policies: only via functions

create or replace function public.commit_attachment_message(p_approval uuid, p_sender uuid, conv uuid, p_body text, p_key text,
  p_mime text, p_name text, p_alt text, p_pages int, p_data bytea)
returns table(message_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare existing uuid; h text; mid uuid; ok uuid;
begin
  select id into existing from messages where sender_id=p_sender and idempotency_key=p_key;
  if found then return query select existing, true; return; end if;
  if not exists(select 1 from memberships where conversation_id=conv and user_id=p_sender and left_at is null and role <> 'reader')
    then raise exception 'not_member' using errcode='42501'; end if;
  if _effective_plan(p_sender) <> 'text_attachments' then raise exception 'plan_required' using errcode='42501'; end if;
  if (select count(*) from messages m join message_attachments a on a.message_id = m.id
      where m.sender_id = p_sender and m.created_at > now() - interval '24 hours') >= 20 then raise exception 'rate_limited' using errcode='P0001'; end if;
  h := encode(digest(p_body || E'\n' || encode(digest(p_data,'sha256'),'hex'),'sha256'),'hex');
  update moderation_approvals set consumed_at = clock_timestamp()
   where id=p_approval and sender_id=p_sender and conversation_id=conv and body_hash=h and consumed_at is null and expires_at > now()
  returning id into ok;
  if ok is null then raise exception 'approval_invalid' using errcode='P0001'; end if;
  insert into messages(conversation_id,sender_id,body,body_hash,idempotency_key) values (conv,p_sender,p_body,h,p_key) returning id into mid;
  insert into message_attachments(message_id,mime,name,alt,size,pages,data) values (mid,p_mime,p_name,nullif(p_alt,''),octet_length(p_data),p_pages,p_data);
  insert into message_deliveries(message_id,recipient_id)
    select mid, m.user_id from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  perform _release_for(m.user_id, false) from memberships m where m.conversation_id=conv and m.left_at is null and m.user_id <> p_sender;
  return query select mid, false;
end $$;
revoke execute on function public.commit_attachment_message(uuid,uuid,uuid,text,text,text,text,text,int,bytea) from public, anon, authenticated;
grant execute on function public.commit_attachment_message(uuid,uuid,uuid,text,text,text,text,text,int,bytea) to service_role;

-- Same visibility as get_messages; no plan needed to view.
create or replace function public.get_attachment(p_message uuid)
returns table(mime text, name text, alt text, pages int, data_b64 text)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); msg messages; mem memberships;
begin
  select * into msg from messages where id = p_message;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into mem from memberships where conversation_id=msg.conversation_id and user_id=me and left_at is null;
  if not found or msg.created_at < mem.joined_at or msg.created_at < _retention_cutoff(me)
    or not (msg.sender_id = me or exists (select 1 from message_deliveries d where d.message_id=msg.id and d.recipient_id=me and d.released_at is not null))
    then raise exception 'not_found' using errcode='P0002'; end if;
  return query select a.mime, a.name, a.alt, a.pages, encode(a.data,'base64') from message_attachments a where a.message_id = p_message;
end $$;
revoke execute on function public.get_attachment(uuid) from public, anon;
grant execute on function public.get_attachment(uuid) to authenticated;

drop function public.get_messages(uuid);
create function public.get_messages(conv uuid)
returns table(id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz, mine boolean, att_mime text, att_name text, att_alt text, att_pages int)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mem memberships; cut timestamptz;
begin
  select * into mem from memberships where conversation_id=conv and user_id=me and left_at is null;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  perform _release_for(me, false);
  cut := _retention_cutoff(me);
  return query
    select msg.id, msg.sender_id, case when msg.sender_id is null then 'Slettet bruger' else _label_for(me, msg.sender_id) end,
      msg.body, msg.created_at, coalesce(msg.sender_id = me, false), a.mime, a.name, a.alt, a.pages
    from messages msg left join message_attachments a on a.message_id = msg.id
    where msg.conversation_id = conv and msg.created_at >= mem.joined_at and msg.created_at >= cut
      and (msg.sender_id = me or exists (select 1 from message_deliveries d
             where d.message_id = msg.id and d.recipient_id = me and d.released_at is not null))
    order by msg.created_at asc limit 500;
end $$;
revoke execute on function public.get_messages(uuid) from public, anon;
grant execute on function public.get_messages(uuid) to authenticated;
