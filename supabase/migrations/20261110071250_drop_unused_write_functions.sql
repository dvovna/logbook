-- The app no longer calls these functions. Its writes are transactions in
-- TypeScript over DATABASE_URL, and the migrations check reads
-- supabase_migrations.schema_migrations itself (docs/direct-postgres-plan.md,
-- stages 3 and 4). The read functions get_projects_list, get_user_projects
-- and get_time_entries_list stay.
drop function if exists public.create_workspace(
    text, text, text, text, timestamp with time zone, text, text, text
);
drop function if exists public.decide_workflow_steps(
    uuid, uuid, text, text, uuid, integer
);
drop function if exists public.replace_user_vacations(uuid, uuid, jsonb);
drop function if exists public.replace_country_holidays(
    uuid, uuid, integer, jsonb
);
drop function if exists public.assign_project_assignments(
    uuid, uuid, uuid[], uuid[]
);
drop function if exists public.set_team_members(uuid, uuid, uuid[], uuid);
drop function if exists public.applied_migrations();
