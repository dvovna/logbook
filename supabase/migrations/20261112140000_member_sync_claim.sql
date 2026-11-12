-- When the daily member import last started for the workspace. Every app
-- process claims a workspace whose import is a day old before it imports,
-- so two processes at once (a zero-downtime deploy) import it once.
alter table public.slack_teams
    add column if not exists members_synced_at timestamptz;

comment on column public.slack_teams.members_synced_at is
  'When the daily member import last started; the process that set it imports';
