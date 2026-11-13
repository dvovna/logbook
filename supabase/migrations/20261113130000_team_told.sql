-- The last step of the setup checklist: an admin or HR got the message that
-- tells the workspace about Logbook. Workspaces installed before the step
-- existed were set up without it and don't get it now.
alter table public.slack_teams
  add column if not exists team_told_at timestamptz;

update public.slack_teams
  set team_told_at = now()
  where team_told_at is null;

comment on column public.slack_teams.team_told_at is
  'When an admin or HR took the message that tells people about Logbook';
