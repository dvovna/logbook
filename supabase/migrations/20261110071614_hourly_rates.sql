-- Hourly rates and amounts (time reports, stage 1): a project's hourly rate,
-- and a person's own rate on a project that replaces it. Rates are in the
-- workspace's currency. Only Admin and HR see and set them; the app checks
-- that, as the API roles can't read any table.

-- One currency per workspace, as an ISO 4217 code. Changing it doesn't
-- convert the rates.
alter table public.slack_teams
    add column currency text not null default 'USD',
    add constraint slack_teams_currency_check check (currency ~ '^[A-Z]{3}$');

comment on column public.slack_teams.currency is
    'ISO 4217 code of the currency that rates and amounts are in.';

-- Null: the project has no rate, and its time shows no amount.
alter table public.projects
    add column hourly_rate numeric(10, 2),
    add constraint projects_hourly_rate_check check (hourly_rate >= 0);

comment on column public.projects.hourly_rate is
    'Hourly rate in the workspace currency; null when not set.';

-- Not columns on project_users: the assignments form replaces those rows (and
-- managers use it, who may not see rates), people on an assigned team log
-- time without one, and Admin and HR log time for anyone. A rate also has to
-- outlive an assignment, for reports on past time.
create table public.project_user_rates (
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    project_id uuid not null
        references public.projects (id) on delete cascade,
    user_id uuid not null
        references public.users (id) on delete cascade,
    hourly_rate numeric(10, 2) not null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    created_by uuid references public.users (id) on delete set null,
    updated_by uuid references public.users (id) on delete set null,
    primary key (project_id, user_id),
    constraint project_user_rates_hourly_rate_check check (hourly_rate >= 0)
);

comment on table public.project_user_rates is
    'A person''s own hourly rate on a project, used instead of the project''s rate';

create index project_user_rates_workspace_idx
    on public.project_user_rates (slack_team_id, project_id);

-- As every table: RLS on with no policies. The app connects as the owner.
alter table public.project_user_rates enable row level security;
