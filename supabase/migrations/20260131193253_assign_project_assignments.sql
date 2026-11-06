CREATE OR REPLACE FUNCTION assign_project_assignments(
    p_project_id uuid,
    p_slack_team_id uuid,
    p_team_ids uuid[],
    p_user_ids uuid[]
)
RETURNS void AS $$
BEGIN
DELETE FROM project_teams
WHERE project_id = p_project_id AND slack_team_id = p_slack_team_id;

INSERT INTO project_teams (slack_team_id, project_id, team_id)
SELECT p_slack_team_id, p_project_id, unnest(p_team_ids);

DELETE FROM project_users
WHERE project_id = p_project_id AND slack_team_id = p_slack_team_id;

INSERT INTO project_users (slack_team_id, project_id, user_id)
SELECT p_slack_team_id, p_project_id, unnest(p_user_ids);

END;
$$ LANGUAGE plpgsql;
