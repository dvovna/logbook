---
title: Configuration
description: Every environment variable Logbook reads, with its default and what it does.
sidebar:
  order: 5
---

Logbook reads its configuration from environment variables, usually from a `.env` file next to `docker-compose.yml` (copy `.env.example` to start). It checks them when it starts. When a required one is missing or a value is wrong, it logs "❌ Invalid environment variables" with the variables at fault and exits.

## Required

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The Postgres connection string. On Supabase, the session pooler string from the project's "Connect" dialog (port 5432, not 6543). Logbook keeps all its data there, and its job queue too, in a `pgboss` schema it creates. It doesn't use Supabase's API or its keys. |
| `SLACK_CLIENT_ID` | Slack app → Basic Information → Client ID. |
| `SLACK_CLIENT_SECRET` | Slack app → Basic Information → Client Secret. |
| `SLACK_SIGN_IN_SECRET` | Slack app → Basic Information → Signing Secret. Logbook refuses any request whose signature doesn't match it. |
| `SLACK_REDIRECT_URI` | `https://<your-domain>/api/slack/oauth/redirect`, the same as in the Slack app's manifest. |
| `SLACK_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts the Slack bot tokens stored in the database. Keep it with your other secrets: without it Logbook can't read the tokens, and every workspace has to install the app again. |

## Optional

| Variable | Default | Value |
| --- | --- | --- |
| `PORT` | `3000`; `10000` in the Docker image | The port Logbook listens on. `docker-compose.yml` sets it from `.env`, `3000` when it isn't there. |
| `DATABASE_POOL_SIZE` | `10` | Database connections Logbook's pool may hold, 1 to 50. The job queue holds 3 more. Keep both together under your Supabase project's Pool Size. A query that gets no connection within 2 seconds fails. See [Operate](/logbook/docs/self-hosting/operate/#database-connections). |
| `JOBS_CONCURRENCY` | `4` | How many background jobs run at once, 1 to 50: messages, approval steps, imports, reminders. The others wait, saved in the database. Keep it well under `DATABASE_POOL_SIZE`, so that a burst of jobs leaves connections to people's clicks. |
| `ALLOWED_SLACK_TEAM_IDS` | Unset: any workspace | Comma-separated Slack workspace IDs (`T…`), for example `T0123ABCD,T0456EFGH`. Only these workspaces may install the app on your server; any other gets a refusal, and its token is revoked. Empty is the same as unset. |
| `SENTRY_DSN` | Unset: nothing is sent | A Sentry project's DSN. Unexpected errors go there, with their stack only: no request data and no people's details. Each event carries the release, `logbook@<version>`. See [Operate](/logbook/docs/self-hosting/operate/#error-tracking-with-sentry). |
| `SENTRY_ENVIRONMENT` | `NODE_ENV`, else `development` | The environment Sentry events carry. In the Docker image `NODE_ENV` is `production`. |
| `UNINSTALLED_DATA_RETENTION_DAYS` | `30` | Days a workspace's data is kept after it uninstalls the app. Installing again within them restores everything. `0` deletes the data when the app is uninstalled. |
| `MIN_YEAR` | `2020` | The first year the year filters offer (time off lists, holidays). At least 1900. |
| `MAX_YEAR` | `2035` | The last year the year filters offer. At most 2100. |

## Limits

Each is a whole number of at least 1.

| Variable | Default | What it limits |
| --- | --- | --- |
| `MAX_REQUESTS_PER_USER` | `500` | Time off requests per person, whatever their status. |
| `MAX_PENDING_REQUESTS_PER_USER` | `5` | Time off requests per person that wait for approval at once. |
| `MAX_TEAMS_PER_SLACK_TEAM` | `10` | Teams per workspace, including the teams a team file creates. |
| `MAX_CLIENTS_PER_SLACK_TEAM` | `10` | Clients per workspace, archived ones included. |
| `MAX_PROJECTS_PER_SLACK_TEAM` | `10` | Projects per workspace, archived ones included. |
| `MAX_POLICIES_PER_SLACK_TEAM` | `10` | Vacation policies per workspace. |
| `MAX_COMPANY_HOLIDAYS_PER_COMPANY_PER_YEAR` | `5` | Company holidays a vacation policy may have in a year, besides the imported public holidays. |

When a limit is reached, the form says so and saves nothing.

## Read outside the check

These aren't checked at startup.

| Variable | Default | Value |
| --- | --- | --- |
| `NODE_ENV` | `production` in the Docker image | `production` writes logs as JSON lines at the `info` level; anything else writes them readable and colored, at the `debug` level. |
| `LOG_LEVEL` | From `NODE_ENV` | The lowest level logged: `debug`, `info`, `warn` or `error`. |
| `SLACK_APP_ID` | none | The Slack app's ID. Logbook doesn't read it: `pnpm slack:app create` writes it, and `pnpm slack:app update` takes the app to update from it. |
| `LOGBOOK_VERSION` | `latest` | Read by `docker-compose.yml` only: the image tag to run, such as `0.4`. |

## Example

The required values and the port, in `.env`:

```ini
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGN_IN_SECRET=
SLACK_REDIRECT_URI=https://logbook.example.com/api/slack/oauth/redirect
SLACK_TOKEN_ENCRYPTION_KEY=
PORT=3000
```
