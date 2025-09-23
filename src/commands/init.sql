-- USERS
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    team_id text references teams(id) not null,
    slack_team_id text references slack_teams(id) not null on delete cascade,
    slack_id text unique not null,
    carryover_days integer default 0,
    is_active boolean default true,
    contract_start_date date not null,
    role text not null check (role in ('member', 'admin', 'hr')),
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    updated_by uuid references users(id) not null,
);

-- SLACK TEAMS
create table if not exists slack_teams (
    id uuid primary key default gen_random_uuid(),
    slack_id text not null unique,
    name text not null unique,
    slack_token text not null unique,
    created_at timestamp with time zone default now()

-- TEAMS
create table if not exists teams (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null references slack_teams(id) on delete cascade,
    vacation_policy_id uuid references vacation_policies(id) on delete set null,
    name text not null,
    manager_approvers text[] default '{}',
    hr_approvers text[] default '{}',
    approval_notification_recipients text[] default '{}',
    manager_approvers_rule text default 'ANY',
    hr_approvers_rule text default 'ANY',
    is_primary boolean default false,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid references users(id),
    updated_by uuid references users(id),
    unique (slack_team_id, name)
);

-- VACATION POLICIES
create table if not exists vacation_policies (
    id uuid primary key default gen_random_uuid(),
    name string not null,
    is_primary boolean default false,
    vacation_days integer not null,
    working_days integer not null,
    bonus_days integer not null default 0,
    carryover_days integer not null default 0,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid references users(id),
    updated_by uuid references users(id) not null
);

-- HOLIDAYS
create table holidays (
    id uuid primary key default gen_random_uuid(),
    vacation_policy_id uuid references vacation_policies(id) on delete cascade not null,
    date date not null,
    year int not null generated always as (extract(year from date)) stored,
    name text not null,
    is_company_custom boolean default false not null,
    is_disabled boolean default false not null,
    slack_team_id uuid references slack_teams(id) on delete cascade not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    created_by uuid references users(id) not null,
    updated_by uuid references users(id) not null
);

-- VACATION_REQUESTS
create table if not exists vacation_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    team_id uuid references teams(id) not null on delete cascade,
    slack_team_id text references slack_teams(id) not null on delete cascade,
    start_date date not null,
    end_date date not null,
    days integer not null,
    working_days integer not null,
    type text not null default 'annual_leave' check (type in ('annual_leave', 'bonus_day', 'sick_leave', 'unpaid_leave', 'other')),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    comments text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid references users(id) not null,
    updated_by uuid references users(id) not null
);

-- VACATION_REQUEST_STEPS
create table if not exists vacation_request_workflow_steps (
    id uuid primary key default gen_random_uuid(),
    vacation_request_id uuid not null references vacation_requests(id) on delete cascade,
    slack_user_id text not null,
    step_level integer not null,
    step_type text not null check (step_type in ('approver')),
    step_data jsonb not null default '{}'::jsonb,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- VACATION_REQUEST_STEP_COMMENTS
CREATE TABLE request_workflow_step_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL,
    slack_team_id TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    step_id UUID NOT NULL,
    created_by UUID NOT NULL,
    step_level integer NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

CONSTRAINT fk_request
    FOREIGN KEY (request_id) REFERENCES vacation_requests(id) ON DELETE CASCADE,
CONSTRAINT fk_step
    FOREIGN KEY (step_id) REFERENCES request_workflow_steps(id) ON DELETE CASCADE,
CONSTRAINT fk_user
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Optional: index for lookups by request
CREATE INDEX idx_request_workflow_step_comments_request_id
    ON request_workflow_step_comments(request_id);