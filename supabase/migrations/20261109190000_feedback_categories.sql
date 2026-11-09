-- Feedback categories (decision 2026-11-09): only "suggestion" (Forslag) and "complaint" (Klage) can be
-- submitted from now on. "filter" is no longer offered. The table CHECK constraint is NOT changed, so
-- existing rows ('filter', 'idea', 'problem', 'other') stay valid. Body is still 1–2000 characters (table CHECK).
create or replace function public.submit_feedback(p_category text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); fid uuid;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if coalesce(p_category,'') not in ('suggestion','complaint') then raise exception 'bad_input' using errcode='22023'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'bad_input' using errcode='22023'; end if;
  if (select count(*) from feedback where user_id = me and created_at > now() - interval '24 hours') >= 5
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into feedback(user_id, category, body) values (me, p_category, trim(p_body)) returning id into fid;
  return fid;
end $$;
revoke execute on function public.submit_feedback(text,text) from public, anon, authenticated;
grant execute on function public.submit_feedback(text,text) to authenticated;
