-- The UTC day whose check for approvers on time off ran, so that a restart
-- or a second process doesn't check it again.
alter table public.slack_teams
  add column if not exists absence_check_date date;

comment on column public.slack_teams.absence_check_date is
  'UTC day whose check for approvers on time off ran';
