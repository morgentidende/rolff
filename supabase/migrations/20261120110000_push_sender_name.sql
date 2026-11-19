-- Notification text names the sender: the recipient's own private nickname (contact_aliases) if
-- there is one, otherwise the sender's e-mail address (Nicolai's decision 2026-11-19; Rolff has no
-- public display names and the recipient already sees this e-mail in the app). Long e-mail
-- addresses are shortened to 40 characters, keeping the domain. If neither exists the generic
-- text is used. Message content is never read here. Muted conversations are excluded, so a muted chat can
-- neither trigger nor appear in a notification. The sender is not told anything: this only
-- shapes the text of the push to the recipient's own device.

-- Shortens an e-mail address to at most 40 characters: keep the domain when it is short enough.
create function public._push_short_email(e text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case
    when e is null or btrim(e) = '' then null
    when char_length(btrim(e)) <= 40 then btrim(e)
    when position('@' in btrim(e)) > 1 and char_length(substr(btrim(e), position('@' in btrim(e)))) <= 24
      then left(btrim(e), 40 - char_length(substr(btrim(e), position('@' in btrim(e)))) - 1) || '…' || substr(btrim(e), position('@' in btrim(e)))
    else left(btrim(e), 39) || '…'
  end
$$;
revoke all on function public._push_short_email(text) from public, anon, authenticated;
grant execute on function public._push_short_email(text) to service_role;

create function public.push_notice_who(uid uuid, p_job bigint, at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare j public.notification_jobs; k int; n int; names text[];
begin
  select * into j from public.notification_jobs where id = p_job and user_id = uid;
  if not found then return null; end if;
  with rel as (
    select m.sender_id, max(d.released_at) last_at, count(*)::int cnt
    from public.message_deliveries d join public.messages m on m.id = d.message_id
    where d.recipient_id = uid and d.released_at is not null
      and d.released_at >= j.created_at - interval '1 second'
      and m.sender_id is not null and m.sender_id <> uid
      and public.is_active_member(m.conversation_id, uid)
      and not public.conversation_is_muted(uid, m.conversation_id, at)
    group by m.sender_id
  ), cleaned as (
    -- own nickname first, else the sender's e-mail; identical cleaning for both
    select r.sender_id, r.last_at,
           nullif(btrim(regexp_replace(coalesce(a.alias, ''),
                '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g')), '') nick,
           nullif(btrim(regexp_replace(coalesce(public._push_short_email(u.email::text), ''),
                '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]', '', 'g')), '') mail
    from rel r
    left join public.contact_aliases a on a.owner_id = uid and a.contact_user_id = r.sender_id
    left join auth.users u on u.id = r.sender_id
  ), named as (
    select sender_id, last_at, left(coalesce(nick, mail), 40) nm from cleaned
  )
  select coalesce((select count(*) from rel), 0)::int,
         coalesce((select sum(cnt) from rel), 0)::int,
         coalesce((select array_agg(nm order by last_at desc) from (
            select nm, last_at from named where nm is not null and nm <> '' order by last_at desc limit 2) t), '{}')
    into k, n, names;
  if k = 0 then return null; end if;
  -- One name unless exactly two senders; more names never fit the short title.
  if k <> 2 and coalesce(array_length(names, 1), 0) > 1 then names := names[1:1]; end if;
  return jsonb_build_object('s', to_jsonb(names), 'k', k, 'n', least(n, 99));
end $$;
revoke all on function public.push_notice_who(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.push_notice_who(uuid, bigint, timestamptz) to service_role;

-- Same as the previous prepare_push, plus 'who' (nickname/e-mail names and counts only; never message text).
create or replace function public.prepare_push(p_job bigint,p_sub uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.push_attempts; j public.notification_jobs; s public.push_subscriptions;
begin
 select * into a from public.push_attempts where job_id=p_job and subscription_id=p_sub and lease=p_lease and done_at is null and lease_until>clock_timestamp();
 if not found then return null; end if;
 select * into j from public.notification_jobs where id=p_job and completed_at is null and created_at>clock_timestamp()-interval '24 hours';
 if not found then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:receive:'||j.user_id::text,0)) then return null; end if;
 if not pg_try_advisory_xact_lock_shared(hashtextextended('rolff:push:'||j.user_id::text,0)) then return null; end if;
 if not exists(select 1 from public.push_runtime where enabled and vapid_public_key is not null) or not exists(select 1 from public.push_preferences where user_id=j.user_id and enabled) or not public.notification_in_receive_window(j.user_id,clock_timestamp(),j.id) or public.notification_job_all_muted(j.user_id,j.id,clock_timestamp()) then return null; end if;
 if not exists(select 1 from public.message_deliveries where recipient_id=j.user_id and released_at is not null and released_at>=j.created_at-interval '1 second') then return null; end if;
 select * into s from public.push_subscriptions where id=p_sub and user_id=j.user_id and expires_at>clock_timestamp() and created_at<=j.created_at;
 if not found or not public._push_endpoint_ok(s.endpoint) then return null; end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),'binding',s.id,'lang',public.locale_of(j.user_id),'who',public.push_notice_who(j.user_id,j.id,clock_timestamp()),'prepared_at',clock_timestamp(),'expires_at',clock_timestamp()+interval '30 seconds');
end $$;
revoke all on function public.prepare_push(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_push(bigint,uuid,uuid) to service_role;
