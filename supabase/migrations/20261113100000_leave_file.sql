-- A leave file HR shared (balances or history): the parsed rows kept between
-- the preview and Apply, and what Apply changed, so Undo can restore it.
create table if not exists public.leave_file_uploads (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    uploaded_by uuid references public.users (id) on delete set null,
    kind text not null check (kind in ('balances', 'history')),
    file_name text not null,
    rows jsonb not null,
    plan_digest text not null,
    status text not null
        check (status in ('previewed', 'applied', 'canceled', 'superseded', 'undone')),
    message_channel text,
    message_ts text,
    undo jsonb,
    created_at timestamptz not null default now(),
    applied_at timestamptz,
    undone_at timestamptz
);

comment on table public.leave_file_uploads is
  'Leave balances and history files shared by HR: the rows between preview and Apply, and what Apply changed for Undo';

-- Serves the workspace foreign key, superseding the open previews of a kind
-- and finding the latest applied upload.
create index if not exists leave_file_uploads_workspace_kind_status_idx
    on public.leave_file_uploads (slack_team_id, kind, status, applied_at desc);

create index if not exists leave_file_uploads_uploaded_by_idx
    on public.leave_file_uploads (uploaded_by) where uploaded_by is not null;

alter table public.leave_file_uploads enable row level security;

-- What a person had left on a day, as HR's file said: one row per person.
create table if not exists public.leave_balances (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    user_id uuid not null
        references public.users (id) on delete cascade,
    balance_on date not null,
    days_left numeric(5, 1),
    working_days_left numeric(5, 1),
    bonus_days_left numeric(5, 1),
    upload_id uuid references public.leave_file_uploads (id) on delete set null,
    set_by uuid references public.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint leave_balances_user_id_key unique (user_id),
    constraint leave_balances_half_days_check check (
        (days_left is null or days_left * 2 = trunc(days_left * 2))
        and (working_days_left is null or working_days_left * 2 = trunc(working_days_left * 2))
        and (bonus_days_left is null or bonus_days_left * 2 = trunc(bonus_days_left * 2))
    ),
    constraint leave_balances_any_value_check check (
        days_left is not null
        or working_days_left is not null
        or bonus_days_left is not null
    )
);

comment on table public.leave_balances is
  'Leave a person had left on a day, from a leave balances file: one row per person';

create index if not exists leave_balances_workspace_idx
    on public.leave_balances (slack_team_id);

create index if not exists leave_balances_upload_idx
    on public.leave_balances (upload_id) where upload_id is not null;

create index if not exists leave_balances_set_by_idx
    on public.leave_balances (set_by) where set_by is not null;

alter table public.leave_balances enable row level security;

alter table public.vacation_requests
    add column if not exists leave_file_upload_id uuid
        references public.leave_file_uploads (id) on delete set null;

comment on column public.vacation_requests.leave_file_upload_id is
  'The leave history file that created the request; null for any other';

create index if not exists vacation_requests_leave_file_upload_idx
    on public.vacation_requests (leave_file_upload_id) where leave_file_upload_id is not null;
