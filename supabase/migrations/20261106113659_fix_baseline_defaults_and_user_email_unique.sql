-- Fixes for schema problems that the baseline inherited from the dev project.

-- Defaults stored as text literals. The dev project kept the quoted SQL
-- expression as the value, so the default was the string `'ANY'::text`, not
-- `ANY`. Inserting a team without approval rules failed the check constraint.
ALTER TABLE public.teams
    ALTER COLUMN manager_approvers_rule SET DEFAULT 'ANY',
    ALTER COLUMN hr_approvers_rule SET DEFAULT 'ANY';

ALTER TABLE public.time_entries
    ALTER COLUMN status SET DEFAULT 'draft';

-- Foreign key columns that defaulted to gen_random_uuid(). A random id never
-- matches a row, so leaving the column out failed the foreign key instead of
-- storing NULL (or failing NOT NULL with a clear message).
ALTER TABLE public.clients
    ALTER COLUMN created_by DROP DEFAULT,
    ALTER COLUMN updated_by DROP DEFAULT,
    ALTER COLUMN archived_by DROP DEFAULT;

ALTER TABLE public.projects
    ALTER COLUMN slack_team_id DROP DEFAULT,
    ALTER COLUMN archived_by DROP DEFAULT;

ALTER TABLE public.project_teams
    ALTER COLUMN slack_team_id DROP DEFAULT;

-- users.email was unique across all workspaces, so a person who is a member
-- of two workspaces that installed the app could not be stored in the second
-- one. Email is unique per workspace now; every lookup by email is scoped by
-- slack_team_id.
ALTER TABLE public.users
    DROP CONSTRAINT users_email_key,
    ADD CONSTRAINT users_slack_team_id_email_key UNIQUE (slack_team_id, email);

-- The new constraint's index starts with slack_team_id, so it serves the
-- queries this index was for.
DROP INDEX public.idx_users_slack_team_id;
