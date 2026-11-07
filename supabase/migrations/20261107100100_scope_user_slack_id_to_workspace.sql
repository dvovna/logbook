-- users.slack_id was unique across all workspaces. On Enterprise Grid one
-- person has the same Slack user ID in every workspace of the organization,
-- so the app could not store them in a second one. The app now looks users up
-- by workspace and Slack user ID together.
ALTER TABLE public.users
    DROP CONSTRAINT users_slack_id_key,
    ADD CONSTRAINT users_slack_team_id_slack_id_key UNIQUE (slack_team_id, slack_id);
