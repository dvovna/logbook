-- ============================================================
-- Time Tracking schema
-- ============================================================

-- Required extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- Clients
-- ============================================================
create table if not exists clients (
    id uuid primary key default gen_random_uuid(),

    name text not null,
    description text,
    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references users (id) on delete set null,
    updated_by uuid references users (id) on delete set null,
    archived_at timestamptz NULL,
    archived_by uuid references users(id) on delete set null,

    constraint clients_team_name_uniq
    unique (slack_team_id, name)
);

comment on table clients is 'Clients for time tracking and billing';
comment on column clients.is_archived is 'Hidden from UI but preserved for history';

-- ============================================================
-- Projects
-- ============================================================
create table if not exists projects (
    id uuid primary key default gen_random_uuid(),

    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    client_id uuid references clients(id) on delete set null,
    status text not null default 'active' check (status in ('active', 'completed', 'on-hold')),
    billable boolean not null default true,

    name text not null,
    description text,

    status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),

    archived_at timestamptz NULL,
    archived_by uuid references users(id) on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    created_by uuid references users (id) on delete set null,
    updated_by uuid references users (id) on delete set null,

    constraint projects_client_name_uniq
    unique (client_id, name)
);

comment on table projects is 'Projects under a client';
comment on column projects.is_archived is 'Archived projects cannot receive new entries';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_project_name_per_team
ON projects (slack_team_id, name)
WHERE archived_at IS NULL;

-- ============================================================
-- Time entries
-- ============================================================
create table if not exists time_entries (
    id uuid primary key default gen_random_uuid(),

    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,

    client_id uuid nullable references clients(id),
    project_id uuid not null references projects(id),

    billable boolean not null default true,

    work_date date not null,
    minutes integer not null check (minutes > 0),

    description text,

    deleted_at timestamptz NULL,
    deleted_by uuid references users(id) on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    created_by uuid references users (id) on delete set null,
    updated_by uuid references users (id) on delete set null,
);

comment on table time_entries is 'Daily time tracking entries';
comment on column time_entries.minutes is 'Tracked time in minutes';
comment on column time_entries.is_deleted is 'Soft delete for audit safety';

-- ============================================================
-- Project teams
-- ============================================================
create table if not exists project_teams (
    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    project_id uuid not null references projects(id) on delete cascade,

    primary key (team_id, project_id)
);

comment on table project_teams is 'Links teams to projects available for time tracking';

create index if not exists idx_project_teams_team
    on project_teams (team_id);

-- ============================================================
-- User projects
-- ============================================================
create table if not exists project_users (
    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    project_id uuid not null references projects(id) on delete cascade,

    primary key (user_id, project_id)
);

comment on table project_users is 'Links users to projects they are allowed to log time against';

create index if not exists idx_project_users_user
    on project_users (user_id);

-- ============================================================
-- Billing reports
-- ============================================================
create table if not exists billing_reports (
    id uuid primary key default gen_random_uuid(),

    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    client_id uuid not null references clients(id),

    period_start date not null,
    period_end date not null,

    total_minutes integer not null,
    total_amount numeric(12,2),

    created_by uuid not null references users(id),
    created_at timestamptz not null default now(),

    is_locked boolean not null default false
);

comment on table billing_reports is 'Immutable billing snapshots';
comment on column billing_reports.is_locked is 'Prevents any further modifications';

-- ============================================================
-- Billing report entries
-- ============================================================
create table if not exists billing_report_entries (
    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    report_id uuid not null references billing_reports(id) on delete cascade,
    time_entry_id uuid not null references time_entries(id),

    primary key (report_id, time_entry_id)
);

comment on table billing_report_entries is 'Links time entries to billing reports';

-- ============================================================
-- Indexes
-- ============================================================

-- Home tab: today / week view
create index if not exists idx_time_entries_user_date
    on time_entries (user_id, work_date)
    where is_deleted = false;

-- Team-level reports
create index if not exists idx_time_entries_team_date
    on time_entries (team_id, work_date)
    where is_deleted = false;

-- Client billing queries
create index if not exists idx_time_entries_client_date
    on time_entries (client_id, work_date)
    where is_deleted = false;
