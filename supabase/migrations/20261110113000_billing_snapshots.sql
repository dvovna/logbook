-- Billing snapshots (time reports, stage 3): a client's approved time of a
-- period, locked together with the rates and amounts it was billed at, for
-- an invoice made elsewhere. Admin and HR create them and mark them invoiced;
-- an admin unlocks one by deleting it. An entry is in one snapshot at most,
-- and an entry in a snapshot can't change until the snapshot is gone.

-- billing_reports and billing_report_entries came with the first schema and
-- were never used. They don't fit: a snapshot is per client, not per team
-- (team_id was NOT NULL with ON DELETE CASCADE, so deleting a team would
-- have deleted invoiced snapshots), there is no invoiced mark or currency,
-- nothing is frozen per line, and an entry could be in two of them.
do $$
begin
    if exists (select 1 from public.billing_report_entries)
        or exists (select 1 from public.billing_reports) then
        raise exception 'billing_reports holds rows: this migration expects the table unused';
    end if;
end
$$;

drop table public.billing_report_entries;
drop table public.billing_reports;

create table public.billing_snapshots (
    id uuid primary key default gen_random_uuid(),
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    -- A client with snapshots can't be deleted (the app only archives them).
    client_id uuid not null references public.clients (id),
    period_start date not null,
    period_end date not null,
    -- The workspace's currency when the snapshot was made.
    currency text not null,
    -- The lines added up: all their time, the billable part, and the amount
    -- of the billable time that had a rate.
    total_minutes integer not null,
    billable_minutes integer not null,
    total_amount numeric(12, 2) not null,
    created_at timestamp with time zone not null default now(),
    created_by uuid references public.users (id) on delete set null,
    -- Set once the snapshot is marked invoiced.
    invoiced_at timestamp with time zone,
    invoiced_by uuid references public.users (id) on delete set null,
    constraint billing_snapshots_period_check
        check (period_end >= period_start),
    constraint billing_snapshots_currency_check
        check (currency ~ '^[A-Z]{3}$'),
    constraint billing_snapshots_totals_check
        check (
            billable_minutes between 0 and total_minutes
            and total_amount >= 0
        )
);

comment on table public.billing_snapshots is
    'A client''s approved time of a period, locked with the rates and amounts it was billed at';

create index billing_snapshots_workspace_idx
    on public.billing_snapshots (slack_team_id, created_at desc);
create index billing_snapshots_client_idx
    on public.billing_snapshots (client_id);

-- One line per time entry. The entry itself can't change while it is here
-- (the trigger below), so its date, person, project and description are
-- read from it; the line keeps what the amount was worked out from.
create table public.billing_snapshot_entries (
    slack_team_id uuid not null
        references public.slack_teams (id) on delete cascade,
    snapshot_id uuid not null
        references public.billing_snapshots (id) on delete cascade,
    -- The primary key: an entry is in one snapshot at most. No ON DELETE:
    -- an entry in a snapshot can't be deleted. Entries are only deleted
    -- with their workspace, which deletes its snapshots in the same
    -- statement.
    time_entry_id uuid primary key references public.time_entries (id),
    minutes integer not null,
    billable boolean not null,
    -- The person's own rate on the project, else the project's; null when
    -- neither was set.
    hourly_rate numeric(10, 2),
    -- The billable time at the rate; null without a rate or when the entry
    -- isn't billable.
    amount numeric(12, 2),
    constraint billing_snapshot_entries_minutes_check check (minutes > 0),
    constraint billing_snapshot_entries_amount_check
        check (amount is null or (billable and hourly_rate is not null))
);

comment on table public.billing_snapshot_entries is
    'The time entries of a billing snapshot, with the rate and amount each was billed at';

create index billing_snapshot_entries_snapshot_idx
    on public.billing_snapshot_entries (snapshot_id);

-- As every table: RLS on with no policies. The app connects as the owner.
alter table public.billing_snapshots enable row level security;
alter table public.billing_snapshot_entries enable row level security;

-- The app refuses to change an entry in a snapshot (TimeEntriesValidationService);
-- this also stops any other path: an owner's or an admin's edit, a delete
-- (deleted_at), an approval or rejection. The team may change: deleting a
-- team leaves its entries without one.
create function public.time_entries_keep_billed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if (
            new.user_id, new.project_id, new.client_id, new.work_date,
            new.minutes, new.billable, new.status, new.description,
            new.deleted_at
        ) is distinct from (
            old.user_id, old.project_id, old.client_id, old.work_date,
            old.minutes, old.billable, old.status, old.description,
            old.deleted_at
        )
        and exists (
            select 1
            from public.billing_snapshot_entries
            where time_entry_id = old.id
        ) then
        raise exception 'time entry % is in a billing snapshot', old.id
            using errcode = 'LB001',
                hint = 'An admin unlocks the snapshot first.';
    end if;

    return new;
end;
$$;

-- PostgreSQL lets PUBLIC execute a new function; see
-- 20261107100000_lock_down_public_api.sql.
revoke execute on function public.time_entries_keep_billed()
    from public, anon, authenticated;

create trigger time_entries_keep_billed
    before update on public.time_entries
    for each row execute function public.time_entries_keep_billed();

-- Deleting a team deleted all the time logged in it (ON DELETE CASCADE),
-- billed time included. The entries stay now, without a team.
alter table public.time_entries
    drop constraint time_entries_team_id_fkey,
    add constraint time_entries_team_id_fkey
        foreign key (team_id) references public.teams (id) on delete set null;
