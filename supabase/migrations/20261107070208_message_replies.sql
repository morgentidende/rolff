-- Additive contract: old clients/exports keep get_messages and both commit functions.
-- No historic messages are rewritten. No snapshot of the target text is stored.
create table public.message_replies (
  message_id uuid primary key references public.messages(id) on delete cascade,
  target_id uuid references public.messages(id) on delete set null,
  -- Opaque retry identity survives target deletion; no quote text/email snapshot.
  target_fingerprint text not null,
  check (message_id <> target_id)
);
create index message_replies_target_idx on public.message_replies(target_id);
alter table public.message_replies enable row level security;
revoke all on public.message_replies from anon, authenticated;
grant select on public.message_replies to service_role;

create function public.assert_reply_target(p_sender uuid, conv uuid, p_reply uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reply is null then return; end if;
  perform m.id from messages m join memberships mem on mem.conversation_id=m.conversation_id
    where m.id=p_reply and m.conversation_id=conv and mem.user_id=p_sender and mem.left_at is null
      and mem.role <> 'reader' and m.created_at >= mem.joined_at and m.created_at >= _retention_cutoff(p_sender)
      and (m.sender_id=p_sender or exists(select 1 from message_deliveries d where d.message_id=m.id and d.recipient_id=p_sender and d.released_at is not null))
    for key share of m;
  if not found then raise exception 'invalid_reply' using errcode='42501'; end if;
end $$;
revoke execute on function public.assert_reply_target(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_reply_target(uuid,uuid,uuid) to service_role;

alter table public.moderation_approvals add column reply_target uuid;
create function public.issue_reply_approval(p_sender uuid,conv uuid,p_hash text,p_provider text,p_model text,p_reply uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare approval uuid;
begin
  perform assert_reply_target(p_sender,conv,p_reply);
  approval:=issue_approval(p_sender,conv,p_hash,p_provider,p_model);
  update moderation_approvals set reply_target=p_reply where id=approval;
  return approval;
end $$;
revoke execute on function public.issue_reply_approval(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_reply_approval(uuid,uuid,text,text,text,uuid) to service_role;

create function public.commit_message_reply(p_approval uuid,p_sender uuid,conv uuid,p_body text,p_key text,p_reply uuid default null)
returns table(message_id uuid,duplicate boolean) language plpgsql security definer set search_path=public,extensions as $$
declare r record; target text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sender::text || ':' || p_key,0));
  if not exists(select 1 from messages where sender_id=p_sender and idempotency_key=p_key) then
    perform assert_reply_target(p_sender,conv,p_reply);
    if not exists(select 1 from moderation_approvals where id=p_approval and sender_id=p_sender and conversation_id=conv and reply_target is not distinct from p_reply) then raise exception 'approval_invalid'; end if;
  end if;
  select * into r from commit_message(p_approval,p_sender,conv,p_body,p_key);
  if r.duplicate then
    select target_fingerprint into target from message_replies where message_replies.message_id=r.message_id;
    if target is distinct from encode(digest(p_reply::text,'sha256'),'hex') or not exists(select 1 from messages where id=r.message_id and conversation_id=conv and body=p_body and not exists(select 1 from message_attachments a where a.message_id=r.message_id)) then raise exception 'idempotency_conflict'; end if;
  elsif p_reply is not null then insert into message_replies(message_id,target_id,target_fingerprint) values(r.message_id,p_reply,encode(digest(p_reply::text,'sha256'),'hex')); end if;
  return query select r.message_id,r.duplicate;
end $$;
revoke execute on function public.commit_message_reply(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.commit_message_reply(uuid,uuid,uuid,text,text,uuid) to service_role;

create function public.commit_attachment_reply(p_approval uuid,p_sender uuid,conv uuid,p_body text,p_key text,p_mime text,p_name text,p_alt text,p_pages int,p_data bytea,p_reply uuid default null)
returns table(message_id uuid,duplicate boolean) language plpgsql security definer set search_path=public,extensions as $$
declare r record; target text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sender::text || ':' || p_key,0));
  if not exists(select 1 from messages where sender_id=p_sender and idempotency_key=p_key) then
    perform assert_reply_target(p_sender,conv,p_reply);
    if not exists(select 1 from moderation_approvals where id=p_approval and sender_id=p_sender and conversation_id=conv and reply_target is not distinct from p_reply) then raise exception 'approval_invalid'; end if;
  end if;
  select * into r from commit_attachment_message(p_approval,p_sender,conv,p_body,p_key,p_mime,p_name,p_alt,p_pages,p_data);
  if r.duplicate then
    select target_fingerprint into target from message_replies where message_replies.message_id=r.message_id;
    if target is distinct from encode(digest(p_reply::text,'sha256'),'hex') or not exists(select 1 from messages m join message_attachments a on a.message_id=m.id where m.id=r.message_id and m.conversation_id=conv and m.body=p_body and a.mime=p_mime and a.name=p_name and a.alt is not distinct from nullif(p_alt,'') and a.pages is not distinct from p_pages and a.data=p_data) then raise exception 'idempotency_conflict'; end if;
  elsif p_reply is not null then insert into message_replies(message_id,target_id,target_fingerprint) values(r.message_id,p_reply,encode(digest(p_reply::text,'sha256'),'hex')); end if;
  return query select r.message_id,r.duplicate;
end $$;
revoke execute on function public.commit_attachment_reply(uuid,uuid,uuid,text,text,text,text,text,int,bytea,uuid) from public,anon,authenticated;
grant execute on function public.commit_attachment_reply(uuid,uuid,uuid,text,text,text,text,text,int,bytea,uuid) to service_role;

create function public.get_messages_v2(conv uuid)
returns table(id uuid,sender_id uuid,sender_name text,body text,created_at timestamptz,mine boolean,att_mime text,att_name text,att_alt text,att_pages int,sender_email text,reply_to_id uuid,reply_body text,has_reply boolean)
language plpgsql security definer set search_path=public as $$
begin
  -- Existing RPC enforces membership, joined_at, release windows and caller retention.
  -- Both message and quote must be visible to this caller. Never disclose a hidden target.
  return query with visible as materialized (select * from get_messages(conv))
    select g.id,g.sender_id,g.sender_name,g.body,g.created_at,g.mine,g.att_mime,g.att_name,g.att_alt,g.att_pages,
      u.email::text, r.target_id, q.body, r.message_id is not null
    from visible g left join auth.users u on u.id=g.sender_id
      left join message_replies r on r.message_id=g.id left join messages q on q.id=r.target_id and q.conversation_id=conv
        and q.created_at >= _retention_cutoff(auth.uid())
        and exists(select 1 from memberships mem where mem.user_id=auth.uid() and mem.conversation_id=conv and mem.left_at is null and q.created_at>=mem.joined_at)
        and (q.sender_id=auth.uid() or exists(select 1 from message_deliveries d where d.message_id=q.id and d.recipient_id=auth.uid() and d.released_at is not null))
    order by g.created_at,g.id;
end $$;
revoke execute on function public.get_messages_v2(uuid) from public,anon;
grant execute on function public.get_messages_v2(uuid) to authenticated;
