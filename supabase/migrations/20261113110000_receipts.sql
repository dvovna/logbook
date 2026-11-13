-- What people are reimbursed for on receipts (sport, internet...). Archived,
-- never deleted, as projects are.
create table if not exists public.reimbursements (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    name text not null,
    due_day smallint not null check (due_day between 1 and 28),
    limit_cents bigint check (limit_cents > 0),
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

comment on table public.reimbursements is
  'Kinds of expense people send receipts for; archived, never deleted';

create unique index if not exists reimbursements_workspace_name_key
    on public.reimbursements (slack_team_id, lower(name))
    where archived_at is null;

-- The unique index above has an expression and a condition, so it doesn't
-- serve the workspace foreign key.
create index if not exists reimbursements_slack_team_id_idx
    on public.reimbursements (slack_team_id);

alter table public.reimbursements enable row level security;

create table if not exists public.receipts (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    user_id uuid not null
        references public.users (id) on delete cascade,
    reimbursement_id uuid
        references public.reimbursements (id) on delete restrict,
    month date,
    amount_cents bigint check (amount_cents > 0),
    comment text,
    status text not null default 'draft'
        check (status in ('draft', 'submitted', 'accepted', 'rejected')),
    rejection_reason text,
    decided_by uuid references public.users (id) on delete set null,
    decided_at timestamptz,
    submitted_at timestamptz,
    file_name text not null,
    mime_type text not null,
    size_bytes bigint not null,
    sha256 text not null,
    slack_file_id text not null,
    file_deleted_at timestamptz,
    created_at timestamptz not null default now(),
    constraint receipts_slack_file_key unique (slack_team_id, slack_file_id),
    constraint receipts_details_check check (
        status = 'draft'
        or (reimbursement_id is not null and month is not null and amount_cents is not null)
    )
);

comment on table public.receipts is
  'Receipt files people sent to the bot, with the details Finance checks; the bytes are in receipt_files';

create index if not exists receipts_workspace_reimbursement_month_idx
    on public.receipts (slack_team_id, reimbursement_id, month);

create index if not exists receipts_user_id_idx on public.receipts (user_id);

create index if not exists receipts_reimbursement_id_idx
    on public.receipts (reimbursement_id) where reimbursement_id is not null;

create index if not exists receipts_decided_by_idx
    on public.receipts (decided_by) where decided_by is not null;

-- Finds a person's earlier receipt with the same file.
create index if not exists receipts_workspace_user_sha256_idx
    on public.receipts (slack_team_id, user_id, sha256);

alter table public.receipts enable row level security;

-- Apart from receipts so that no list or select * reads the bytes.
create table if not exists public.receipt_files (
    receipt_id uuid primary key
        references public.receipts (id) on delete cascade,
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    content bytea not null
);

create index if not exists receipt_files_slack_team_id_idx
    on public.receipt_files (slack_team_id);

alter table public.receipt_files enable row level security;

create table if not exists public.reimbursement_opt_outs (
    user_id uuid not null
        references public.users (id) on delete cascade,
    reimbursement_id uuid not null
        references public.reimbursements (id) on delete cascade,
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    primary key (user_id, reimbursement_id)
);

create index if not exists reimbursement_opt_outs_reimbursement_id_idx
    on public.reimbursement_opt_outs (reimbursement_id);

create index if not exists reimbursement_opt_outs_slack_team_id_idx
    on public.reimbursement_opt_outs (slack_team_id);

alter table public.reimbursement_opt_outs enable row level security;

-- The claim that keeps a reminder to one.
create table if not exists public.reimbursement_reminders (
    reimbursement_id uuid not null
        references public.reimbursements (id) on delete cascade,
    month date not null,
    kind text not null check (kind in ('opened', 'due', 'summary')),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (reimbursement_id, month, kind)
);

create index if not exists reimbursement_reminders_slack_team_id_idx
    on public.reimbursement_reminders (slack_team_id);

alter table public.reimbursement_reminders enable row level security;
