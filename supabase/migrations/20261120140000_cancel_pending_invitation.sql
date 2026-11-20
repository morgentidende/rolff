-- "Annullér invitation" on a conversation that is still only waiting for the invitee.
--
-- cancel_pending_invitation(inv): for a conversation where the caller is the ONLY active member (nobody has
-- accepted yet) it (1) revokes every open invitation of that conversation (same columns as decline_invitation(),
-- so the pending nicknames are dropped by the invitation_alias_settle trigger) and (2) lets the caller leave the
-- conversation, so the empty row disappears from the front page. Nothing is deleted: any rows stay in the database
-- (Rolff keeps evidence), they are just no longer listed. A conversation that already has another active member
-- is refused ('not_pending_only') - those invitations keep using decline_invitation()/revoke_invitation().
-- The invitee is not told anything (no e-mail, no push); the old link simply stops working.
create or replace function public.cancel_pending_invitation(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); i invitations;
begin
  if me is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select * into i from invitations where id = inv for update;
  if not found or i.accepted_at is not null or not public.is_active_member(i.conversation_id, me)
    then raise exception 'not_found' using errcode='P0002'; end if;
  if exists (select 1 from memberships o where o.conversation_id = i.conversation_id and o.left_at is null and o.user_id <> me)
    then raise exception 'not_pending_only' using errcode='P0001'; end if;
  update invitations x set revoked_at = now(), declined_at = now(), declined_by = me
   where x.conversation_id = i.conversation_id and x.accepted_at is null and x.revoked_at is null;
  update memberships set left_at = now() where conversation_id = i.conversation_id and user_id = me and left_at is null;
end $$;
revoke execute on function public.cancel_pending_invitation(uuid) from public, anon, authenticated;
grant execute on function public.cancel_pending_invitation(uuid) to authenticated;
