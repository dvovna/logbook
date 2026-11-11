-- A team file HR shared: the parsed rows kept between the preview and Apply,
-- and what Apply changed, so Undo can restore it.
create table if not exists public.team_file_uploads (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    uploaded_by uuid references public.users (id) on delete set null,
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

comment on table public.team_file_uploads is
  'Team files shared by HR: the rows between preview and Apply, and what Apply changed for Undo';

-- Serves the workspace foreign key, superseding the open previews and finding
-- the latest applied upload.
create index if not exists team_file_uploads_workspace_status_idx
    on public.team_file_uploads (slack_team_id, status, applied_at desc);

create index if not exists team_file_uploads_uploaded_by_idx
    on public.team_file_uploads (uploaded_by) where uploaded_by is not null;

alter table public.team_file_uploads enable row level security;
