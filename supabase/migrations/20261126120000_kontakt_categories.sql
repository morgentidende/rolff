-- Kontakt categories (2026-11-26): new submissions are "feedback" (Feedback) or
-- "app_problem" (Problemer med Rolff-appen / Problems with the Rolff app).
-- Old client values suggestion → feedback and complaint → app_problem, so a
-- staged release stays available (migration, then feedback function, then web).
-- The CHECK keeps historical values (suggestion, complaint, filter, idea, problem, other).
alter table public.feedback drop constraint feedback_category_check;
alter table public.feedback add constraint feedback_category_check
  check (category in ('feedback','app_problem','suggestion','complaint','filter','idea','problem','other'));

create or replace function public.submit_feedback(p_category text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); fid uuid; cat text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  cat := case coalesce(p_category,'')
    when 'feedback' then 'feedback'
    when 'app_problem' then 'app_problem'
    when 'suggestion' then 'feedback'
    when 'complaint' then 'app_problem'
    else null
  end;
  if cat is null then raise exception 'bad_input' using errcode='22023'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'bad_input' using errcode='22023'; end if;
  if (select count(*) from feedback where user_id = me and created_at > now() - interval '24 hours') >= 5
    then raise exception 'rate_limited' using errcode='P0001'; end if;
  insert into feedback(user_id, category, body) values (me, cat, trim(p_body)) returning id into fid;
  return fid;
end $$;
revoke execute on function public.submit_feedback(text,text) from public, anon, authenticated;
grant execute on function public.submit_feedback(text,text) to authenticated;
