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

Security fixes go into the latest commit on `development`. There are no maintained release branches yet.

## Notes for people who self-host

- `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. Keep it on the server, and never expose the Supabase project to clients with it.
- Every Slack request is verified with the signing secret, so keep `SLACK_SIGN_IN_SECRET` secret too.
- Bot tokens of installed workspaces are stored in the `slack_teams` table. Restrict access to the database accordingly.
