-- Time off as time (#51): an admin maps each leave type to a project and
-- sets the hours of a working day; an approved vacation can then be logged
-- as approved time entries on its type's project.

-- The hours of a working day, in minutes, in 15-minute steps like time
-- entries. 8 hours until an admin sets it.
alter table public.slack_teams
  add column if not exists time_off_minutes_per_day integer not null default 480;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'slack_teams_time_off_minutes_per_day_check'
    ) then
        alter table public.slack_teams
            add constraint slack_teams_time_off_minutes_per_day_check
            check (
                time_off_minutes_per_day > 0
                and time_off_minutes_per_day <= 1440
                and time_off_minutes_per_day % 15 = 0
            );
    end if;
end
$$;

comment on column public.slack_teams.time_off_minutes_per_day is
  'Minutes of a working day, which a day of time off is logged as';

-- The project each leave type is logged on. "Other" has none. Projects are
-- archived, never deleted, so the cascade only matters when the workspace
-- is deleted.
create table if not exists public.time_off_projects (
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    vacation_type text not null
        check (vacation_type in (
            'annual_leave', 'bonus_day', 'sick_leave', 'unpaid_leave'
        )),
    project_id uuid not null
        references public.projects (id) on delete cascade,
    primary key (slack_team_id, vacation_type)
);

comment on table public.time_off_projects is
  'The project that time off of each leave type is logged on';

create index if not exists time_off_projects_project_idx
    on public.time_off_projects (project_id);

alter table public.time_off_projects enable row level security;

-- The vacation that a time entry was logged from. The entry stays when the
-- request is deleted.
alter table public.time_entries
  add column if not exists vacation_request_id uuid
    references public.vacation_requests (id) on delete set null;

create index if not exists time_entries_vacation_request_idx
    on public.time_entries (vacation_request_id)
    where vacation_request_id is not null;

comment on column public.time_entries.vacation_request_id is
  'The approved vacation this entry was logged from, if any';
