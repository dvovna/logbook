-- The app reaches the database only with the service role key. The anon and
-- authenticated roles of the Supabase API are meant for clients, and the anon
-- key is public by design, so they get no access to the app's data.

-- Row-level security on every table, without policies: only the service role,
-- which bypasses RLS, can read or write. The Time & Billing tables had it off.
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END
$$;

-- No privileges for the API roles either, so a table added later without RLS
-- is still closed. Functions run with EXECUTE for PUBLIC by default, and
-- get_time_entries_list is SECURITY DEFINER, so it bypassed RLS for anyone.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- The same for objects that later migrations create.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
