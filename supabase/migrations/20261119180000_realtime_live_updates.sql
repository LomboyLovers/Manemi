-- Live updates (lib/manemi/realtime.ts): stream changes on these tables over
-- Supabase Realtime. Row-level security still applies: each user only gets
-- events for rows they can already read (their groups, their friendships,
-- invitations to them). The app treats an event as "refresh now".

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['Group_Activity', 'Group_Member', 'Group_Invitation', 'Friendship'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
