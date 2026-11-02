-- Hosted Postgres has pg_safeupdate (DELETE without WHERE rejected); avoid the temp table.
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
  select count(*) into found_n from get_messages(conv) g where g.id = any(p_message_ids);
  if found_n <> (select count(distinct x) from unnest(p_message_ids) x) then raise exception 'bad_messages' using errcode='22023'; end if;
  insert into report_log(user_id, conversation_id, category, attached_count) values (me, conv, p_category, found_n);
  return query select g.id, g.sender_name, g.body, g.created_at from get_messages(conv) g where g.id = any(p_message_ids) order by g.created_at;
end $$;
