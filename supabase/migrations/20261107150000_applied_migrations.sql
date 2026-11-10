-- Which migrations the database has, for the app's check at startup: an
-- updated app on a database that misses migrations would otherwise start and
-- fail later on missing columns or functions. Null when the database has no
-- migration history of the Supabase CLI (e.g. the schema was applied by hand),
-- so the app can tell "unknown" from "none applied".
create function applied_migrations()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if to_regclass('supabase_migrations.schema_migrations') is null then
        return null;
    end if;

    return array(select version from supabase_migrations.schema_migrations);
end;
$$;

-- New functions are executable by PUBLIC (see 20261107100000); only the
-- app's service role may call this one.
revoke execute on function applied_migrations() from public, anon, authenticated;
grant execute on function applied_migrations() to service_role;
