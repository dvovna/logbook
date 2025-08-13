-- USERS
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    team_id text references teams(id) not null,
    slack_team_id text references slack_teams(id) not null on delete cascade,
    slack_id text unique not null,
    contract_start_date date not null,
    role text not null check (role in ('member', 'admin', 'hr')),
    created_at timestamp with time zone default now()
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
    name text not null,
    is_primary boolean default false,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid references users(id),
    updated_by uuid references users(id),
    unique (slack_team_id, name)
);

-- TEAM SETTINGS
create table if not exists team_settings (
    id uuid primary key default gen_random_uuid(),
    team_id uuid references teams(id) not null unique,
    vacation_days integer not null default 28,
    bonus_days integer not null default 3,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid references users(id) not null,
    updated_by uuid references users(id) not null
);
-- VACATIONS
create table if not exists vacations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    team_id uuid references teams(id) not null on delete cascade,
    start_date date not null,
    end_date date not null,
    days integer not null,
    type text not null default 'annual_leave' check (type in ('annual_leave', 'bonus_day', 'sick_leave', 'unpaid_leave', 'other')),
    status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
    comments text,
    approved_by_manager boolean default false,
    approved_by_hr boolean default false,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    created_by uuid references users(id) not null,
    updated_by uuid references users(id) not null
);
