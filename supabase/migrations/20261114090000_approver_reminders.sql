-- The week and the day whose reminder of what waits for their approval went
-- out to approvers, beside time_reminder_week and time_reminder_day of the
-- reminders of unsubmitted time: claimed apart, so either goes once.
alter table public.slack_teams
  add column if not exists approver_reminder_week date,
  add column if not exists approver_reminder_day date;

comment on column public.slack_teams.approver_reminder_week is
  'Monday of the week whose weekly reminder to approvers was sent';

comment on column public.slack_teams.approver_reminder_day is
  'Day whose daily reminder to approvers was sent';
