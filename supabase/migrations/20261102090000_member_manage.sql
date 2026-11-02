-- Members list with roles, remove extra participant, downgrade writer->reader, leave conversation.
create or replace function public.list_conversation_members(conv uuid)
returns table(user_id uuid, label text, role public.member_role, me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_active_member(conv, auth.uid()) then raise exception 'not_member' using errcode = 'P0001'; end if;
  return query select m.user_id, _label_for(auth.uid(), m.user_id), m.role, m.user_id = auth.uid()
    from memberships m where m.conversation_id = conv and m.left_at is null order by (m.role = 'parent') desc, m.joined_at;
end $$;

create or replace function public.remove_member(conv uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where conversation_id = conv and user_id = auth.uid() and left_at is null and role = 'parent')
    then raise exception 'forbidden' using errcode = 'P0001'; end if;
  update memberships set left_at = now() where conversation_id = conv and user_id = p_user and left_at is null and role <> 'parent';
  if not found then raise exception 'bad_target' using errcode = 'P0001'; end if;
end $$;

-- Only downgrade (writer -> reader). Upgrading needs a new invitation so every parent consents.
create or replace function public.set_member_role(conv uuid, p_user uuid, p_role public.member_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where conversation_id = conv and user_id = auth.uid() and left_at is null and role = 'parent')
    then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if p_role <> 'reader' then raise exception 'needs_new_invitation' using errcode = 'P0001'; end if;
  update memberships set role = 'reader' where conversation_id = conv and user_id = p_user and left_at is null and role = 'writer';
  if not found then raise exception 'bad_target' using errcode = 'P0001'; end if;
end $$;

create or replace function public.leave_conversation(conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update memberships set left_at = now() where conversation_id = conv and user_id = auth.uid() and left_at is null;
  if not found then raise exception 'not_member' using errcode = 'P0001'; end if;
end $$;

revoke execute on function public.list_conversation_members(uuid), public.remove_member(uuid, uuid), public.set_member_role(uuid, uuid, public.member_role), public.leave_conversation(uuid) from public, anon;
grant execute on function public.list_conversation_members(uuid), public.remove_member(uuid, uuid), public.set_member_role(uuid, uuid, public.member_role), public.leave_conversation(uuid) to authenticated;
