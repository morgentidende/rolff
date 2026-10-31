-- Explicit grants (newer Supabase projects do not auto-grant table access to API roles).
revoke all on all tables in schema public from anon, authenticated;
grant select, update, insert on public.profiles to authenticated;
grant select on public.conversations, public.memberships to authenticated;
grant select, insert, update, delete on public.receive_settings, public.receive_windows to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
