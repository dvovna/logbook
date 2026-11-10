-- The Monday of the week whose reminder about unsubmitted time went out to
-- the workspace's people, so a restart doesn't send it twice.
alter table public.slack_teams
  add column if not exists time_reminder_week date;

comment on column public.slack_teams.time_reminder_week is
  'Monday of the week whose reminder about unsubmitted time was sent';
