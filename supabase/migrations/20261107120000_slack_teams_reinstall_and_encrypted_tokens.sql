-- Slack workspace names are not unique: a second workspace called "Acme"
-- could not install the app, and anyone could take a name first.
ALTER TABLE public.slack_teams DROP CONSTRAINT IF EXISTS slack_teams_name_key;

-- Bot tokens are stored encrypted with a random IV, so two equal tokens never
-- look the same; the unique index only held the plain-text tokens.
ALTER TABLE public.slack_teams DROP CONSTRAINT IF EXISTS slack_teams_slack_token_key;
