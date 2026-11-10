-- The team form takes the team's members: the people chosen join the team
-- (leaving any other one), and members not chosen any more leave it. One
-- transaction, so a failure never leaves a half-changed team. Only users of
-- the workspace are touched, whatever IDs come in. Returns the members.
create function set_team_members(
    p_slack_team_id uuid,
    p_team_id uuid,
    p_user_ids uuid[],
    p_updated_by uuid
)
returns setof users
language plpgsql
set search_path = public
as $$
begin
    if not exists (
        select 1 from teams where id = p_team_id and slack_team_id = p_slack_team_id
    ) then
        raise exception 'Team % is not in workspace %', p_team_id, p_slack_team_id;
    end if;

    update users
       set team_id = null, updated_at = now(), updated_by = p_updated_by
     where slack_team_id = p_slack_team_id
       and team_id = p_team_id
       and not (id = any (p_user_ids));

    return query
    update users
       set team_id = p_team_id, updated_at = now(), updated_by = p_updated_by
     where slack_team_id = p_slack_team_id
       and id = any (p_user_ids)
    returning *;
end;
$$;

-- New functions are executable by PUBLIC (see 20261107100000): only the
-- app's service role may call this one.
revoke execute on function set_team_members(uuid, uuid, uuid[], uuid)
    from public, anon, authenticated;
grant execute on function set_team_members(uuid, uuid, uuid[], uuid)
    to service_role;
