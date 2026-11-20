-- Blocked topics: like blocked words, adding one requires the user's explicit confirmation (p_ack = true)
-- that the sender will be told the topic is blocked. Nothing is stored about the confirmation itself.
-- Release order: apply this migration, then deploy the web bundle right after (the new bundle sends p_ack;
-- an old cached bundle cannot add topics until it reloads, adding words is unaffected).
drop function if exists public.add_blocked_topic(uuid,text);
create function public.add_blocked_topic(conv uuid,p_word text,p_ack boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=auth.uid(); w text:=regexp_replace(trim(coalesce(p_word,'')), '\s+', ' ', 'g'); result uuid;
begin
 if me is null or not public.is_active_member(conv,me) then raise exception 'not_member' using errcode='42501'; end if;
 if p_ack is not true then raise exception 'ack_required' using errcode='P0001'; end if;
 -- Conversation-first lock order agrees with existing membership RPCs and message FKs.
 perform 1 from public.conversations where id=conv for key share;
 -- Lock before count to enforce the bound under concurrent adds.
 perform 1 from public.conversation_filter_revision where conversation_id=conv for update;
 if char_length(w) not between 2 and 240 then raise exception 'length'; end if;
 if (select count(*) from public.conversation_blocked_topics where conversation_id=conv and user_id=me)>=20 then raise exception 'too_many'; end if;
 insert into public.conversation_blocked_topics(conversation_id,user_id,word) values(conv,me,w)
 on conflict(conversation_id,user_id,word) do update set word=excluded.word returning id into result;
 return result;
end $$;
revoke all on function public.add_blocked_topic(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.add_blocked_topic(uuid,text,boolean) to authenticated;
