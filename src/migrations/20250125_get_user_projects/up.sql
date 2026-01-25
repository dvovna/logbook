create or replace function get_user_projects(
  p_user_id uuid,
  p_slack_team_id uuid,
  p_include_archived boolean default false
)
returns table (
  project_id uuid,
  project_name text
)
language sql
stable
as $$
  with user_team as (
    select team_id
    from users
    where id = p_user_id
      and slack_team_id = p_slack_team_id
  ),
  direct_projects as (
    select pu.project_id
    from project_users pu
    where pu.user_id = p_user_id
      and pu.slack_team_id = p_slack_team_id
  ),
  team_projects as (
    select pt.project_id
    from project_teams pt
    join user_team ut on ut.team_id = pt.team_id
    where pt.slack_team_id = p_slack_team_id
  ),
  all_projects as (
    select project_id from direct_projects
    union
    select project_id from team_projects
  )
select
    p.id as project_id,
    p.name as project_name
from projects p
         join all_projects ap on ap.project_id = p.id
where p.slack_team_id = p_slack_team_id
  and (
    p_include_archived = true
        or p.archived_at is null
    )
order by p.name;
$$;
