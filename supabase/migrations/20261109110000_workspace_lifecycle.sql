-- A workspace's install, uninstall and bot token.

-- Uninstalling the app used to delete the workspace and, by cascade, all its
-- data at once: an accidental uninstall lost everything. Now the token goes
-- and the workspace is marked; its data is deleted after a grace period
-- (UNINSTALLED_DATA_RETENTION_DAYS), and installing again within it restores
-- the workspace as it was.
ALTER TABLE public.slack_teams
    ALTER COLUMN slack_token DROP NOT NULL,
    ADD COLUMN uninstalled_at timestamp with time zone,
    -- Token rotation: Slack's bot tokens then expire after 12 hours and come
    -- with a refresh token. Encrypted like slack_token; both null for a
    -- token that never expires (an install from before rotation).
    ADD COLUMN slack_refresh_token text,
    ADD COLUMN slack_token_expires_at timestamp with time zone;

COMMENT ON COLUMN public.slack_teams.slack_token IS
    'The bot token, encrypted with SLACK_TOKEN_ENCRYPTION_KEY. Null once the app is uninstalled.';
COMMENT ON COLUMN public.slack_teams.uninstalled_at IS
    'When the app was uninstalled. The workspace and its data are deleted after UNINSTALLED_DATA_RETENTION_DAYS; installing again clears it.';
COMMENT ON COLUMN public.slack_teams.slack_refresh_token IS
    'Refreshes a rotating bot token, encrypted like slack_token. Null for a token that never expires.';
COMMENT ON COLUMN public.slack_teams.slack_token_expires_at IS
    'When the rotating bot token expires. Null for a token that never expires.';

CREATE INDEX slack_teams_uninstalled_at_idx
    ON public.slack_teams (uninstalled_at)
    WHERE uninstalled_at IS NOT NULL;

-- A new install: the workspace and the installing admin in one transaction.
-- Before, a failure between the two left a workspace without an admin.
-- The tokens come encrypted.
create function create_workspace(
    p_slack_id text,
    p_name text,
    p_slack_token text,
    p_slack_refresh_token text,
    p_slack_token_expires_at timestamp with time zone,
    p_admin_slack_id text,
    p_admin_email text,
    p_admin_name text
)
returns setof slack_teams
language plpgsql
set search_path = public
as $$
declare
    v_workspace slack_teams;
begin
    insert into slack_teams (
        slack_id, name, slack_token, slack_refresh_token,
        slack_token_expires_at
    )
    values (
        p_slack_id, p_name, p_slack_token, p_slack_refresh_token,
        p_slack_token_expires_at
    )
    returning * into v_workspace;

    insert into users (slack_team_id, slack_id, email, name, role)
    values (v_workspace.id, p_admin_slack_id, p_admin_email, p_admin_name, 'admin');

    return next v_workspace;
end;
$$;

-- New functions are executable by PUBLIC (see 20261107100000): only the
-- app's service role may call this one.
revoke execute on function create_workspace(text, text, text, text, timestamp with time zone, text, text, text)
    from public, anon, authenticated;
grant execute on function create_workspace(text, text, text, text, timestamp with time zone, text, text, text)
    to service_role;
