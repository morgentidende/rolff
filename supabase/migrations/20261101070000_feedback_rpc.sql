-- Feedback goes through a rate-limited RPC (5 per 24h per user); direct inserts are no longer granted.
create or replace function public.submit_feedback(p_category text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); fid uuid;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  if (select count(*) from feedback where user_id = me and created_at > now() - interval '24 hours') >= 5
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into feedback(user_id, category, body) values (me, coalesce(nullif(p_category,''),'other'), trim(p_body)) returning id into fid;
  return fid;
end $$;
revoke execute on function public.submit_feedback(text,text) from public, anon, authenticated;
grant execute on function public.submit_feedback(text,text) to authenticated;
revoke insert on public.feedback from authenticated;
