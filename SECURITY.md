# Security policy

The bot handles data about employees, including their absences and possibly sick leave, plus Slack bot tokens. Please report security problems privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Please include:
- what an attacker could do;
- the steps to reproduce;
- the affected version or commit.

You should get an answer within a week.

## Supported versions

Security fixes go into the next release, cut from `development`, and its image. Only the latest release gets them; there are no maintained release branches yet.

## Notes for people who self-host

- `DATABASE_URL` is a full Postgres connection that bypasses row-level security. Keep it on the server. The app doesn't use the Supabase API or its keys, and the tables and functions are closed to the API's `anon` and `authenticated` roles.
- Every Slack request is verified with the signing secret, so keep `SLACK_SIGN_IN_SECRET` secret too.
- Bot tokens of installed workspaces are stored in the `slack_teams` table, encrypted with `SLACK_TOKEN_ENCRYPTION_KEY`, together with the refresh tokens of rotating ones. With token rotation on (the manifest's default), a bot token expires after 12 hours. Keep the key apart from database backups: with both, the tokens can be read. Without the key the app can't use them, and every workspace has to install the app again.
- With public distribution on, any Slack workspace that has your install link can install the app on your server. Leave it off unless you mean to serve other workspaces, or list the ones you serve in `ALLOWED_SLACK_TEAM_IDS`.
- When a workspace uninstalls the app, its token is removed at once and its data (people, absences, time entries) is kept for `UNINSTALLED_DATA_RETENTION_DAYS` (30 by default), then deleted. Set it to 0 to delete the data at once, and say in your privacy notice which you chose.
