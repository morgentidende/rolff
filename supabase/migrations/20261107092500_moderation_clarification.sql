-- Intelligibility is a separate, content-free moderation outcome.
alter table public.moderation_attempts drop constraint moderation_attempts_decision_check;
alter table public.moderation_attempts add constraint moderation_attempts_decision_check
  check (decision in ('allow','block','clarify','error'));

-- Legacy issuers remain callable but cannot mint consumable current-policy tickets.
-- This rejects both existing tickets and old in-flight Edge instances at cutover.
-- Already accepted idempotent retries return before consuming any ticket.
alter table public.moderation_approvals add column policy_version smallint not null default 0
  check (policy_version in (0,1));
create function public._enforce_moderation_policy() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if old.consumed_at is null and new.consumed_at is not null and old.policy_version < 1 then
    raise exception 'approval_policy_outdated';
  end if;
  return new;
end $$;
revoke all on function public._enforce_moderation_policy() from public,anon,authenticated;
create trigger enforce_moderation_policy before update of consumed_at on public.moderation_approvals
  for each row execute function public._enforce_moderation_policy();

-- Only the updated moderation endpoints call this issuer after an ALLOW result.
-- Clarify never reaches an issuer, commit or attachment-storage operation.
create function public.issue_reply_approval_v2(p_sender uuid,conv uuid,p_hash text,p_provider text,p_model text,p_reply uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare approval uuid;
begin
  approval:=public.issue_reply_approval(p_sender,conv,p_hash,p_provider,p_model,p_reply);
  update public.moderation_approvals set policy_version=1 where id=approval;
  return approval;
end $$;
revoke all on function public.issue_reply_approval_v2(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_reply_approval_v2(uuid,uuid,text,text,text,uuid) to service_role;
