-- Why a vacation request or a time entry was rejected, as the approver typed
-- it in the Reject form. Optional; the app keeps it at most 300 characters.
ALTER TABLE public.vacation_requests
    ADD COLUMN rejection_reason text,
    ADD CONSTRAINT vacation_requests_rejection_reason_length
        CHECK (char_length(rejection_reason) <= 300);

ALTER TABLE public.time_entries
    ADD COLUMN rejection_reason text,
    ADD CONSTRAINT time_entries_rejection_reason_length
        CHECK (char_length(rejection_reason) <= 300);

COMMENT ON COLUMN public.vacation_requests.rejection_reason IS
    'Why the request was rejected, as the approver wrote it.';
COMMENT ON COLUMN public.time_entries.rejection_reason IS
    'Why the entry was last rejected; cleared once it is changed or submitted again.';

-- get_time_entries_list also returns the reason, for the owner's list of
-- entries. The return type changes, so the function is dropped first.
drop function get_time_entries_list(
    uuid, integer, integer, uuid, uuid, uuid, uuid, date, date, date, boolean,
    text, uuid[], uuid
);

create function get_time_entries_list(
    p_slack_team_id uuid,
    p_limit integer default 20,
    p_offset integer default 0,

    p_user_id uuid default null,
    p_project_id uuid default null,
    p_client_id uuid default null,
    p_team_id uuid default null,

    p_work_date date default null,
    p_from_work_date date default null,
    p_to_work_date date default null,

    p_billable boolean default null,

    p_status text default null,
    p_team_ids uuid[] default null,
    p_exclude_user_id uuid default null
)
returns table (
    id uuid,
    user_id uuid,
    user_name text,
    project_id uuid,
    project_name text,
    client_name text,
    team_id uuid,
    work_date date,
    minutes integer,
    billable boolean,
    status text,
    description text,
    rejection_reason text,
    created_at timestamptz,
    updated_at timestamptz,
    total_count integer
)
language sql
stable
security definer
as $$
with filtered as (
    select te.*
    from time_entries te
    where te.slack_team_id = p_slack_team_id
      and te.deleted_at is null

      -- exact filters
      and (p_user_id is null or te.user_id = p_user_id)
      and (p_project_id is null or te.project_id = p_project_id)
      and (p_client_id is null or te.client_id = p_client_id)
      and (p_team_id is null or te.team_id = p_team_id)
      and (p_billable is null or te.billable = p_billable)
      and (p_status is null or te.status = p_status)
      and (p_team_ids is null or te.team_id = any (p_team_ids))
      and (p_exclude_user_id is null or te.user_id <> p_exclude_user_id)

      -- date filters
      and (
            p_work_date is null
            or te.work_date = p_work_date
          )
      and (
            p_from_work_date is null
            or te.work_date >= p_from_work_date
          )
      and (
            p_to_work_date is null
            or te.work_date <= p_to_work_date
          )
),
with_meta as (
    select
        f.id,
        f.user_id,
        u.name as user_name,
        f.project_id,
        p.name as project_name,
        c.name as client_name,
        f.team_id,
        f.work_date,
        f.minutes,
        f.billable,
        f.status,
        f.description,
        f.rejection_reason,
        f.created_at,
        f.updated_at
    from filtered f
        join users u on u.id = f.user_id
        left join projects p on p.id = f.project_id
        left join clients c on c.id = f.client_id
),
paged as (
    select *
    from with_meta
    order by work_date desc, created_at desc
    limit p_limit
    offset p_offset
)
select
    p.*,
    (select count(*) from filtered) as total_count
from paged p;
$$;

-- A new function is executable by PUBLIC: the default privileges set in
-- 20261107100000_lock_down_public_api.sql cannot take back PostgreSQL's
-- global default. The function is SECURITY DEFINER, so close it explicitly.
revoke execute on function get_time_entries_list(
    uuid, integer, integer, uuid, uuid, uuid, uuid, date, date, date, boolean,
    text, uuid[], uuid
) from public, anon, authenticated;
grant execute on function get_time_entries_list(
    uuid, integer, integer, uuid, uuid, uuid, uuid, date, date, date, boolean,
    text, uuid[], uuid
) to service_role;
