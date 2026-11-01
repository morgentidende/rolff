-- Conversations have no visible titles (column kept for data, no longer exposed). Per-user private colour per conversation.
comment on column public.conversations.title is 'Deprecated: not shown or returned; conversations are labelled by counterpart (alias or e-mail).';

create table public.conversation_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  color text not null check (color in ('teal','blue','violet','rose','red','amber','green','slate')),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_prefs enable row level security;
create policy prefs_owner on public.conversation_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.conversation_prefs from anon, authenticated;
grant select on public.conversation_prefs to authenticated;
grant all on public.conversation_prefs to service_role;

create or replace function public.set_conversation_color(conv uuid, p_color text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member(conv, auth.uid()) then raise exception 'not_member' using errcode='42501'; end if;
  if p_color is null or p_color = '' then delete from conversation_prefs where user_id = auth.uid() and conversation_id = conv; return; end if;
  insert into conversation_prefs(user_id, conversation_id, color) values (auth.uid(), conv, p_color)
    on conflict (user_id, conversation_id) do update set color = excluded.color, updated_at = now();
end $$;

drop function public.list_my_conversations();
create function public.list_my_conversations()
returns table(id uuid, role public.member_role, members int, others jsonb, color text)
language sql stable security definer set search_path = public as $$
  select c.id, m.role, (select count(*)::int from memberships x where x.conversation_id=c.id and x.left_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'email', u.email,
        'alias', (select alias from contact_aliases a where a.owner_id = auth.uid() and a.contact_user_id = o.user_id)) order by o.joined_at)
      from memberships o join auth.users u on u.id = o.user_id
      where o.conversation_id = c.id and o.left_at is null and o.user_id <> auth.uid()), '[]'::jsonb),
    (select p.color from conversation_prefs p where p.user_id = auth.uid() and p.conversation_id = c.id)
  from conversations c join memberships m on m.conversation_id=c.id and m.user_id=auth.uid() and m.left_at is null
  order by c.created_at desc
$$;
revoke execute on function public.list_my_conversations(), public.set_conversation_color(uuid,text) from public, anon;
grant execute on function public.list_my_conversations(), public.set_conversation_color(uuid,text) to authenticated;
