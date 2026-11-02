-- Reports (Apple 1.2 / Google Play UGC). Minimal logging: ONLY metadata needed for rate limiting.
-- No report text and no message text is stored; the content goes only in the mail to FEEDBACK_TO.
create table public.report_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  category text not null check (category in ('harassment','inappropriate','child_safety','other')),
  attached_count int not null default 0 check (attached_count between 0 and 20),
  created_at timestamptz not null default now()
);
alter table public.report_log enable row level security;
revoke all on public.report_log from anon, authenticated;
grant all on public.report_log to service_role;

-- Called with the reporter's JWT. Checks membership, category, rate limit (3 per 24h), and that every
-- attached message id is visible to the reporter (same rules as get_messages). Returns the attached
-- messages (sender name, time, text) for the mail; nothing about them is stored.
create or replace function public.submit_report(conv uuid, p_category text, p_message_ids uuid[] default '{}')
returns table(id uuid, sender_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int := coalesce(array_length(p_message_ids,1),0); found_n int;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if p_category not in ('harassment','inappropriate','child_safety','other') then raise exception 'bad_input' using errcode='22023'; end if;
  if n > 20 then raise exception 'bad_input' using errcode='22023'; end if;
  if not exists (select 1 from memberships m where m.conversation_id=conv and m.user_id=me and m.left_at is null)
    then raise exception 'not_member' using errcode='42501'; end if;
  if (select count(*) from report_log r where r.user_id=me and r.created_at > now() - interval '24 hours') >= 3
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  create temp table if not exists _rep(id uuid, sender_name text, body text, created_at timestamptz) on commit drop;
  delete from _rep;
  insert into _rep select g.id, g.sender_name, g.body, g.created_at from get_messages(conv) g where g.id = any(p_message_ids);
  select count(*) into found_n from _rep;
  if found_n <> (select count(distinct x) from unnest(p_message_ids) x) then raise exception 'bad_messages' using errcode='22023'; end if;
  insert into report_log(user_id, conversation_id, category, attached_count) values (me, conv, p_category, found_n);
  return query select r.id, r.sender_name, r.body, r.created_at from _rep r order by r.created_at;
end $$;
revoke execute on function public.submit_report(uuid,text,uuid[]) from public, anon;
grant execute on function public.submit_report(uuid,text,uuid[]) to authenticated;
