-- get_time_entries_list (#69), the same arguments and columns, made cheap to
-- call for My time, Time logs and the Approvals lists.
--
-- SECURITY INVOKER: Postgres never inlines a SECURITY DEFINER function, so
-- its body was planned once, without the arguments: the `p_x is null or ...`
-- filters could use no index but the workspace's, and each call read the
-- workspace's whole history. Inlined, the call is planned with its
-- arguments, and My time reads one person's rows through
-- idx_time_entries_user_project. The app calls it as the tables' owner;
-- DEFINER was for the REST API, which is closed (20261107100000).
--
-- NOT MATERIALIZED: `filtered` is read twice, for the page and for the count,
-- and Postgres materializes such a CTE: every row of the filtered set was
-- copied (to disk on Time logs) before the page was cut. Each reading now
-- gets its own plan: the page reads its rows in the order of
-- idx_time_entries_list_main and stops at its limit, the count reads an
-- index.
create or replace function public.get_time_entries_list(
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
security invoker
as $$
with filtered as not materialized (
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

-- As in 20261107130000: only the app's service role may call it.
revoke execute on function public.get_time_entries_list(
    uuid, integer, integer, uuid, uuid, uuid, uuid, date, date, date, boolean,
    text, uuid[], uuid
) from public, anon, authenticated;
grant execute on function public.get_time_entries_list(
    uuid, integer, integer, uuid, uuid, uuid, uuid, date, date, date, boolean,
    text, uuid[], uuid
) to service_role;
