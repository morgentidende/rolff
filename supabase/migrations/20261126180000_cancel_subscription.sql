-- Cancel a paid plan at period end (pending_plan = 'free'), keeping the account and data.
-- 'free' has the same sending limits as Standard (160 characters, no attachments/export/extra people).
-- TODO(store-billing): when App Store / Google Play billing is connected, in-app "Opsig abonnement"
-- should deep-link to the store subscription page (Apple: apps.apple.com/account/subscriptions or
-- showManageSubscriptions; Google Play: play.google.com/store/account/subscriptions). Store-billed
-- renewals are cancelled in the store, not only by setting pending_plan here. Sync period_end from
-- the store webhook. Do not assume deleting this row cancels Apple/Google billing.

alter table public.user_plans drop constraint user_plans_plan_check;
alter table public.user_plans add constraint user_plans_plan_check check (plan in ('free','text','text_attachments'));
alter table public.user_plans drop constraint user_plans_pending_plan_check;
alter table public.user_plans add constraint user_plans_pending_plan_check check (pending_plan in ('free','text','text_attachments'));

create or replace function public.cancel_my_subscription()
returns table(plan text, pending_plan text, period_end timestamptz)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  insert into user_plans(user_id) values (me) on conflict (user_id) do nothing;
  cur := _effective_plan(me);
  if cur = 'free' then raise exception 'not_subscribed' using errcode='P0001'; end if;
  update user_plans set pending_plan = 'free', updated_at = now() where user_id = me;
  return query select u.plan, u.pending_plan, u.period_end from user_plans u where u.user_id = me;
end $$;

create or replace function public.resume_my_subscription()
returns table(plan text, pending_plan text, period_end timestamptz)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur text; pend text;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  insert into user_plans(user_id) values (me) on conflict (user_id) do nothing;
  cur := _effective_plan(me);
  select p.pending_plan into pend from user_plans p where p.user_id = me;
  if pend is distinct from 'free' then raise exception 'not_cancelling' using errcode='P0001'; end if;
  update user_plans set pending_plan = null, updated_at = now() where user_id = me;
  return query select u.plan, u.pending_plan, u.period_end from user_plans u where u.user_id = me;
end $$;

revoke execute on function public.cancel_my_subscription(), public.resume_my_subscription() from public, anon;
grant execute on function public.cancel_my_subscription(), public.resume_my_subscription() to authenticated;
