-- Show who a pending invitation is for on the conversation list (home screen).
-- When the other party has not joined yet, others=[] and the UI used to say only
-- "Venter på den anden part" with avatar letter "V". Expose the invitee email.
drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table(id uuid, role public.member_role, members int, others jsonb, color text, pending_invitee text)
language sql stable security definer set search_path = public as $$
  select c.id, m.role,
    (select count(*)::int from memberships x where x.conversation_id=c.id and x.left_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'email', _public_label(o.user_id),
        'alias', (select alias from contact_aliases a where a.owner_id = auth.uid() and a.contact_user_id = o.user_id)) order by o.joined_at)
      from memberships o
      where o.conversation_id = c.id and o.left_at is null and o.user_id <> auth.uid()), '[]'::jsonb),
    (select p.color from conversation_prefs p where p.user_id = auth.uid() and p.conversation_id = c.id),
    (select i.invitee_email from invitations i
      where i.conversation_id = c.id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at > now() and i.member_version = c.member_version
        and i.invitee_email is not null
      order by i.created_at desc limit 1)
  from conversations c join memberships m on m.conversation_id=c.id and m.user_id=auth.uid() and m.left_at is null
  order by c.created_at desc
$$;
revoke execute on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;
