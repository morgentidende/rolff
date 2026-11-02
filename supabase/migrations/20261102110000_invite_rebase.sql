-- When someone joins, other open invitations in the conversation used to become
-- silently stale (hidden from the list, link fails). Instead, carry them over to the
-- new member set: earlier approvals from still-active members are kept, the new member
-- must also approve, and any already-mailed link stops working until a fresh one is sent.
create or replace function public._rebase_pending_invitations()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.member_version is distinct from old.member_version then
    update invitation_consents ic set member_version = new.member_version
      from invitations i
      where ic.invitation_id = i.id and i.conversation_id = new.id and i.member_version = old.member_version
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        and public.is_active_member(new.id, ic.user_id);
    update invitations set member_version = new.member_version, token_hash = digest(gen_random_bytes(32),'sha256')
      where conversation_id = new.id and member_version = old.member_version
        and accepted_at is null and revoked_at is null and expires_at > now();
  end if;
  return new;
end $$;
revoke execute on function public._rebase_pending_invitations() from public, anon, authenticated;
drop trigger if exists rebase_pending_invitations on public.conversations;
create trigger rebase_pending_invitations after update of member_version on public.conversations
  for each row execute function public._rebase_pending_invitations();
-- One-time catch-up for open invitations that already went stale.
update invitation_consents ic set member_version = c.member_version
  from invitations i join conversations c on c.id = i.conversation_id
  where ic.invitation_id = i.id and i.member_version <> c.member_version
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    and public.is_active_member(c.id, ic.user_id);
update invitations i set member_version = c.member_version, token_hash = extensions.digest(extensions.gen_random_bytes(32),'sha256')
  from conversations c
  where c.id = i.conversation_id and i.member_version <> c.member_version
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
