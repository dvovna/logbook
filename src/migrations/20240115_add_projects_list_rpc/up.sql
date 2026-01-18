CREATE OR REPLACE FUNCTION get_projects_list(
    p_slack_team_id uuid,
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0,
    p_client_id uuid DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_billable boolean DEFAULT NULL,
    p_search text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    name text,
    status text,
    billable boolean,
    created_at timestamptz,
    updated_at timestamptz,
    client_name text,
    users_count int,
    teams text[],
    total_count int
)
LANGUAGE sql
STABLE
AS $$
WITH filtered_projects AS (
    SELECT p.*
    FROM projects p
    WHERE p.slack_team_id = p_slack_team_id
      AND p.archived_at IS NULL
      AND (p_client_id IS NULL OR p.client_id = p_client_id)
      AND (p_status IS NULL OR p.status = p_status)
      AND (p_billable IS NULL OR p.billable = p_billable)
      AND (
        p_search IS NULL
        OR p.name ILIKE '%' || p_search || '%'
      )
),
projects_with_meta AS (
    SELECT
        fp.id,
        fp.name,
        fp.status,
        fp.billable,
        fp.created_at,
        fp.updated_at,
        c.name AS client_name,
        COUNT(DISTINCT up.user_id) AS users_count,
        ARRAY_AGG(DISTINCT t.name)
            FILTER (WHERE t.name IS NOT NULL) AS teams
    FROM filtered_projects fp
        LEFT JOIN clients c ON c.id = fp.client_id
        LEFT JOIN team_projects tp ON tp.project_id = fp.id
        LEFT JOIN teams t ON t.id = tp.team_id
        LEFT JOIN user_projects up ON up.project_id = fp.id
    GROUP BY fp.id, fp.name, fp.status, fp.billable, fp.created_at, fp.updated_at, c.name
),
paged_projects AS (
    SELECT *
    FROM projects_with_meta
    ORDER BY name ASC
    LIMIT p_limit
    OFFSET p_offset
)
SELECT
    pp.*,
    (SELECT COUNT(*) FROM filtered_projects) AS total_count
FROM paged_projects pp;
$$;
