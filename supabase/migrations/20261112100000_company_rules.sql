-- Company rules: one rule set per workspace (the second approval level and
-- its rule, who hears about decisions, the vacation policy) that teams
-- follow unless they keep their own. Named sets can come later, so a set has
-- an optional name; the company rules are the set with is_default.
create table if not exists public.rule_sets (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    name text,
    is_default boolean not null default false,
    hr_approvers text[] not null default '{}',
    hr_approvers_rule text not null default 'ANY'
        check (hr_approvers_rule in ('ANY', 'ALL')),
    approval_notification_recipients text[] not null default '{}',
    vacation_policy_id uuid
        references public.vacation_policies (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.users (id) on delete set null
);

comment on table public.rule_sets is
  'Rules that teams follow instead of their own; the default set is the company rules';

-- At most one set of company rules per workspace. This is also what makes
-- "create the default if missing" safe to run twice at once.
create unique index if not exists rule_sets_one_default
    on public.rule_sets (slack_team_id) where is_default;

create index if not exists rule_sets_vacation_policy_idx
    on public.rule_sets (vacation_policy_id);

alter table public.rule_sets enable row level security;

-- Null means the team has its own rules (the columns on teams).
alter table public.teams
    add column if not exists rule_set_id uuid
        references public.rule_sets (id) on delete set null;

comment on column public.teams.rule_set_id is
  'The rule set the team follows; null when the team has its own rules';

create index if not exists teams_rule_set_idx on public.teams (rule_set_id);

-- Every existing workspace gets its company rules, empty. Existing teams keep
-- their own rules (rule_set_id stays null).
insert into public.rule_sets (slack_team_id, is_default)
select id, true from public.slack_teams
on conflict do nothing;
