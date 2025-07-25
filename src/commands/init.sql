-- USERS
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    slack_id text unique not null,
    role text not null check (role in ('employee', 'admin', 'hr')),
    created_at timestamp with time zone default now()
);

-- TEAMS
npm i supabase@">=1.8.1" --save-dev



-- VACATIONS
create table if not exists vacations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    start_date date not null,
    end_date date not null,
    days integer not null,
    type text not null check (type in ('vacation', 'bonus')),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    approved_by_manager boolean default false,
    approved_by_hr boolean default false,
    created_at timestamp with time zone default now()
);

-- SETTINGS
create table if not exists settings (
    key text primary key,
    value text not null
);

-- Seed initial settings
insert into settings (key, value) values
    ('default_vacation_days', '28'),
    ('default_bonus_days', '3')
    on conflict (key) do nothing;