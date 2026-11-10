-- Decides the open steps of a vacation request's workflow in one statement:
-- the status, who decided and when go into step_data, and completed_at closes
-- the step. Before, these were separate requests, and a failure between them
-- left a step decided but open, so its level never completed.
--
-- Only steps that are still open are touched, so of two approvers who decide
-- at the same moment only the first changes anything; the caller gets the
-- steps it decided and an empty result when someone else was first.
-- p_step_id narrows it to one step, p_step_level to one level; with neither,
-- every open step of the request is decided (a cancel).
create function decide_workflow_steps(
    p_slack_team_id uuid,
    p_request_id uuid,
    p_status text,
    p_decided_by_slack_id text,
    p_step_id uuid default null,
    p_step_level integer default null
)
returns setof request_workflow_steps
language sql
security definer
set search_path = public
as $$
    update request_workflow_steps
       set step_data = step_data || jsonb_build_object(
               'status', p_status,
               'decided_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'decided_by_slack_id', p_decided_by_slack_id
           ),
           completed_at = now(),
           updated_at = now()
     where slack_team_id = p_slack_team_id
       and request_id = p_request_id
       and completed_at is null
       and (p_step_id is null or id = p_step_id)
       and (p_step_level is null or step_level = p_step_level)
    returning *;
$$;

-- New functions are executable by PUBLIC (see 20261107100000); this one is
-- SECURITY DEFINER, so only the app's service role may call it.
revoke execute on function decide_workflow_steps(uuid, uuid, text, text, uuid, integer)
    from public, anon, authenticated;
grant execute on function decide_workflow_steps(uuid, uuid, text, text, uuid, integer)
    to service_role;
