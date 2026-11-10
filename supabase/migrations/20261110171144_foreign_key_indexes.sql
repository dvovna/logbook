-- Indexes for every foreign key, for what waits for an approver, and primary
-- keys for the project assignments.
--
-- Postgres checks a foreign key from the referenced side too: deleting a row
-- (or setting the key null) looks for the rows that point at it, one query
-- per deleted row and per foreign key. Without an index that starts with the
-- referencing column, that query reads the whole table, every workspace's
-- rows. Deleting a workspace deletes its users, projects, teams and the rest
-- by cascade, so it ran one such scan per user and per foreign key to users:
-- a workspace of 300 people, with another workspace's 300k time entries in
-- the table, took 20 s, past the 10 s statement timeout. Uninstalled
-- workspaces were never deleted.
--
-- Columns that are mostly null (archived_by, deleted_by, invoiced_by) get a
-- partial index: a lookup by a value never matches null.

-- Time entries. The indexes that start with slack_team_id leave out deleted
-- entries, so the cascade from slack_teams, which deletes those too, can't
-- use them.
create index if not exists time_entries_slack_team_id_idx
    on public.time_entries (slack_team_id);
create index if not exists time_entries_user_id_idx
    on public.time_entries (user_id);
create index if not exists time_entries_project_id_idx
    on public.time_entries (project_id);
create index if not exists time_entries_client_id_idx
    on public.time_entries (client_id);
create index if not exists time_entries_team_id_idx
    on public.time_entries (team_id);
create index if not exists time_entries_created_by_idx
    on public.time_entries (created_by);
create index if not exists time_entries_updated_by_idx
    on public.time_entries (updated_by);
create index if not exists time_entries_deleted_by_idx
    on public.time_entries (deleted_by) where deleted_by is not null;

-- The entries waiting for a decision, counted on the Approvals button every
-- time Home opens. Without it the count reads all of the workspace's time.
create index if not exists time_entries_submitted_idx
    on public.time_entries (slack_team_id, team_id)
    where status = 'submitted' and deleted_at is null;

-- The open steps of an approver, counted on the Approvals button every time
-- Home opens (RequestWorkflowStepsService.findWaitingFor). The table had no
-- index on the workspace, so the count read every workspace's steps. The
-- index also serves the cascade from slack_teams.
create index if not exists request_workflow_steps_approver_idx
    on public.request_workflow_steps (slack_team_id, slack_user_id);

create index if not exists request_workflow_step_comments_slack_team_id_idx
    on public.request_workflow_step_comments (slack_team_id);
create index if not exists billing_snapshot_entries_slack_team_id_idx
    on public.billing_snapshot_entries (slack_team_id);

-- People.
create index if not exists users_team_id_idx
    on public.users (team_id);
create index if not exists users_updated_by_idx
    on public.users (updated_by);

-- Time off.
create index if not exists vacation_requests_created_by_idx
    on public.vacation_requests (created_by);
create index if not exists vacation_requests_updated_by_idx
    on public.vacation_requests (updated_by);
create index if not exists vacation_policies_created_by_idx
    on public.vacation_policies (created_by);
create index if not exists vacation_policies_updated_by_idx
    on public.vacation_policies (updated_by);
create index if not exists holidays_vacation_policy_id_idx
    on public.holidays (vacation_policy_id);
create index if not exists holidays_created_by_idx
    on public.holidays (created_by);
create index if not exists holidays_updated_by_idx
    on public.holidays (updated_by);

-- Teams, projects, clients, rates, snapshots.
create index if not exists teams_created_by_idx
    on public.teams (created_by);
create index if not exists teams_updated_by_idx
    on public.teams (updated_by);
create index if not exists projects_created_by_idx
    on public.projects (created_by);
create index if not exists projects_updated_by_idx
    on public.projects (updated_by);
create index if not exists projects_archived_by_idx
    on public.projects (archived_by) where archived_by is not null;
create index if not exists clients_created_by_idx
    on public.clients (created_by);
create index if not exists clients_updated_by_idx
    on public.clients (updated_by);
create index if not exists clients_archived_by_idx
    on public.clients (archived_by) where archived_by is not null;
create index if not exists project_user_rates_user_id_idx
    on public.project_user_rates (user_id);
create index if not exists project_user_rates_created_by_idx
    on public.project_user_rates (created_by);
create index if not exists project_user_rates_updated_by_idx
    on public.project_user_rates (updated_by);
create index if not exists billing_snapshots_created_by_idx
    on public.billing_snapshots (created_by);
create index if not exists billing_snapshots_invoiced_by_idx
    on public.billing_snapshots (invoiced_by) where invoiced_by is not null;

-- A project's teams and people had no primary key, so a pair could be stored
-- twice. Drop the copies, then key the pairs; the key's index serves the
-- foreign key to projects.
delete from public.project_teams a
 using public.project_teams b
 where a.ctid > b.ctid
   and a.project_id = b.project_id
   and a.team_id = b.team_id;

delete from public.project_users a
 using public.project_users b
 where a.ctid > b.ctid
   and a.project_id = b.project_id
   and a.user_id = b.user_id;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'project_teams_pkey'
          and conrelid = 'public.project_teams'::regclass
    ) then
        alter table public.project_teams
            add constraint project_teams_pkey primary key (project_id, team_id);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'project_users_pkey'
          and conrelid = 'public.project_users'::regclass
    ) then
        alter table public.project_users
            add constraint project_users_pkey primary key (project_id, user_id);
    end if;
end
$$;

create index if not exists project_teams_slack_team_id_idx
    on public.project_teams (slack_team_id);
create index if not exists project_users_slack_team_id_idx
    on public.project_users (slack_team_id);

-- Indexes that no query needs. Every query names its workspace, so an index
-- on a column of all workspaces' rows (a status, a flag, dates) is not used;
-- the others repeat the first columns of another index.
drop index if exists public.idx_users_is_active;
drop index if exists public.idx_users_team_lookup;         -- starts with id, the primary key
drop index if exists public.idx_vacation_requests_status;
drop index if exists public.idx_vacation_requests_dates;
drop index if exists public.idx_vacation_requests_user_id; -- idx_vacation_requests_user_year_status
drop index if exists public.idx_workflow_steps_step_level;
drop index if exists public.idx_time_entries_work_date;    -- idx_time_entries_list_main
drop index if exists public.idx_clients_name;              -- clients_team_name_uniq
drop index if exists public.idx_team_projects_team;        -- idx_project_teams_team
drop index if exists public.idx_user_projects_user;        -- idx_project_users_user_team
