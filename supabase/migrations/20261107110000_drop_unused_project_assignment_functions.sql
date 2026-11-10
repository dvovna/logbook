-- assign_project_teams and assign_project_users come from the scripts that
-- preceded supabase/migrations. assign_project_assignments replaced them: no
-- migration creates them and nothing calls them, so only the dev project has
-- them.
DROP FUNCTION IF EXISTS public.assign_project_teams(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.assign_project_users(uuid, uuid, uuid[]);
