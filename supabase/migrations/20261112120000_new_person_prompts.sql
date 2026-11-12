-- Set once the workspace's members were imported for the first time. A
-- person who appears after that is new, and HR is asked which team they are
-- on; the first import (an install) asks about nobody. Existing workspaces
-- have been imported already.
alter table public.slack_teams
    add column if not exists members_imported_at timestamptz;

update public.slack_teams
    set members_imported_at = now()
    where members_imported_at is null;

comment on column public.slack_teams.members_imported_at is
  'When the first member import finished; people added after it get a team question for HR';

-- The DM that asks one HR person (or admin) which team a new person is on,
-- kept to close it when the person is placed.
create table if not exists public.new_person_prompts (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    user_id uuid not null
        references public.users (id) on delete cascade,
    recipient_slack_id text not null,
    channel text not null,
    ts text not null,
    closed_at timestamptz,
    created_at timestamptz not null default now()
);

comment on table public.new_person_prompts is
  'DMs asking HR which team a new person is on, one per person and recipient';

-- One question per person and recipient, so the job is safe to run twice;
-- it also serves the foreign key to the person.
create unique index if not exists new_person_prompts_user_recipient_key
    on public.new_person_prompts (user_id, recipient_slack_id);

create index if not exists new_person_prompts_slack_team_idx
    on public.new_person_prompts (slack_team_id);

alter table public.new_person_prompts enable row level security;
