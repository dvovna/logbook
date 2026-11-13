-- How often a person is reminded of time they haven't submitted. Everyone
-- starts at once a week, as it was for all before.
alter table public.users
  add column if not exists time_reminder text not null default 'weekly';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_time_reminder_check'
  ) then
    alter table public.users
      add constraint users_time_reminder_check
      check (time_reminder in ('off', 'daily', 'weekly', 'monthly'));
  end if;
end $$;

comment on column public.users.time_reminder is
  'How often the person is reminded of unsubmitted time: off, daily, weekly or monthly';

-- The day whose reminder went out to the people reminded every working day,
-- beside time_reminder_week for the weekly and monthly ones.
alter table public.slack_teams
  add column if not exists time_reminder_day date;

comment on column public.slack_teams.time_reminder_day is
  'Day whose daily reminder about unsubmitted time was sent';
