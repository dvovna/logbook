create or replace function get_time_entries_list(
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

    p_billable boolean default null
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
    description text,
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
        f.description,
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

create index concurrently if not exists idx_time_entries_list_main
    on time_entries (
    slack_team_id,
    work_date desc,
    created_at desc
    )
    where deleted_at is null;

create index concurrently if not exists idx_time_entries_work_date
    on time_entries (
    slack_team_id,
    work_date
    )
    where deleted_at is null;

create index concurrently if not exists idx_time_entries_user_project
    on time_entries (
    slack_team_id,
    user_id,
    project_id,
    work_date
    )
    where deleted_at is null;
