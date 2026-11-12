---
title: Operate
description: 'Keep a self-hosted Logbook fast and healthy: where to run it, connections, restarts, health checks, errors, logs, data retention and backups.'
sidebar:
  order: 4
---

Once Logbook is installed, a few settings decide whether it answers Slack in time, survives restarts and keeps your data.

## Run the app next to its database

Run Logbook in the same region as its database.

Slack waits 3 seconds for an answer to a click. Every SQL statement is a round trip to the database, and a click such as saving a week or approving a request sends up to ten of them one after another before the app answers. A round trip takes about a millisecond within a region and about 100 ms between regions. Far from its database, the app spends up to a second of Slack's 3 on the database alone. Every statement also holds one of the pooler's few connections a hundred times longer, so the whole installation manages only a few clicks a second.

## Database connections

Logbook holds two sets of connections to the database:

| Who | Connections | Set by |
| --- | --- | --- |
| The app's pool | 10 | `DATABASE_POOL_SIZE` |
| The job queue | 3 | Fixed |

Together they must stay under the Supabase project's **Pool Size**: the connections the session pooler allows at once for all its clients, 15 on the smaller compute sizes. 10 + 3 leaves 2 for `supabase db push` or `psql`. On a bigger compute size with a bigger Pool Size you can raise `DATABASE_POOL_SIZE`, keeping the same room.

A query that finds no free connection within 2 seconds fails, and Slack shows an error instead of waiting for nothing.

`JOBS_CONCURRENCY` (default 4) is how many background jobs run at once: messages, approval steps, imports, reminders. The others wait their turn, saved in the database, so a restart loses none. Keep it well under `DATABASE_POOL_SIZE`, so that a burst such as the Monday reminder leaves connections to the clicks people wait on.

## One instance

Run one instance of Logbook. A second one beside it for a while, as in a zero-downtime deploy, is safe: the two share the bot tokens and the daily work through the database, and only one of them refreshes a token or imports a workspace's members.

Each instance keeps its own caches (bot tokens for a day, public holidays for an hour), runs the jobs it started, and holds its own database connections. Two instances count against the Pool Size together, so with two at once, keep both pools within it.

## Restarts and deploys

On a restart or a deploy Logbook gets SIGTERM. It then:

1. stops taking requests at once;
2. finishes what is in flight (an approval, a CSV on its way) for up to 12 seconds;
3. closes its connections, in 22 seconds at most from the signal.

`docker stop` kills a container after 10 seconds, too early. Give it 30 seconds:

| Where | Setting |
| --- | --- |
| `docker-compose.yml` | `stop_grace_period: 30s` (already set) |
| `docker run` | `--stop-timeout 30` |
| Render | `maxShutdownDelaySeconds` in `render.yaml` (set in `deploy/render.yaml`) |
| Fly.io | `kill_timeout` in `fly.toml` (set in `deploy/fly.toml`) |

Work cut off by a shorter grace period isn't lost: the next process retries it, but it comes minutes late.

## Check an install

`pnpm checkup` says what an install or an update still lacks, one line a check, with what to do under each one that fails:

```
✓ Configuration: every required variable is set and well formed
✓ Database: connected
✓ Migrations: all 35 of this release are applied
✓ API access: the API roles reach none of Logbook's tables or functions
! Round trip to the database: 119 ms
    → Run Logbook in the database's region: a click sends up to ten statements one after another before Slack's 3 seconds run out
✓ Logbook from outside: https://logbook.example.com/health answers 200
– Slack app: needs SLACK_CONFIG_TOKEN (an app configuration token)
```

| Check | What it looks at |
| --- | --- |
| `env` | The variables, by the rules Logbook starts with; the redirect URI's shape; that `DATABASE_URL` isn't the transaction pooler. |
| `database` | The connection, this release's migrations, that Supabase's API roles reach nothing, and the time of a round trip (a warning over 20 ms). |
| `app` | `https://<your-domain>/health`, from where you run the command. |
| `slack` | That every URL of the Slack app is on your domain. It needs `SLACK_APP_ID` and an app configuration token in `SLACK_CONFIG_TOKEN`, and is skipped without them. |

Name the checks to run only some: `pnpm checkup env database`. It reads `.env`, prints no secret, and exits with 1 when a check fails. In the Docker image, where there is no pnpm: `docker exec logbook node dist/checkup.js`.

## Health check

`GET /health` answers 200 (`{"status":"ok"}`) while the app reaches its database and 503 (`{"status":"unavailable"}`) when the database doesn't answer within 3 seconds. Point your platform's health check at it. The Docker image already uses it: every 30 seconds, after a 30-second start, failing after 3 misses. A passing check doesn't appear in the logs; a failing one logs a warning with the reason.

:::caution[Supabase free plan]
Supabase pauses a free project after 7 days of little activity. A quiet week, such as the New Year holidays, is enough, and then the bot stops answering until someone restores the project in the Supabase dashboard. Every `/health` call runs a query, and Supabase counts database activity, so make sure something calls it regularly. The image's health check does it under Docker, but some platforms ignore it and need their own pointed at `/health`.
:::

## Background jobs

The work that must happen even when Slack or the database fails for a while (approvals, the messages people get, imports, the members import, reminders, CSV files) runs as jobs, saved in the database in a `pgboss` schema next to the data. A job runs at once. When it fails, it is tried again from 5 minutes later, up to 8 times with growing delays, about 8 hours in all. A job a stopped process didn't finish is retried too.

The app also runs work on a timer:

| Work | When |
| --- | --- |
| Import the members of each workspace | Checked every hour, the first time 10 minutes after the start; a workspace is imported once a day. |
| The Monday reminder of unsubmitted time | Checked every 10 minutes; sent from Monday 09:00 UTC, once a week. |
| Delete workspaces uninstalled longer than the retention period | A minute after the start, then every 6 hours. |

## Error tracking with Sentry

Set `SENTRY_DSN` to a Sentry project's DSN to get unexpected errors there. Without it, nothing leaves your server and errors are only logged.

What is sent:
- requests that failed with a server error;
- failures in work after an answer, and jobs that won't be tried again;
- a workspace whose Monday reminder couldn't be started;
- an uninstalled workspace that couldn't be deleted;
- a start that failed.

Each event holds the error and its stack only: no request data, people, cookies, headers, bodies, query strings, job payloads or local variables, and no tracing. Stack traces name the TypeScript file and line.

Each event carries:
- the release, `logbook@<version>` (for example `logbook@0.4.1`), so an issue shows which version brought it;
- the environment: `SENTRY_ENVIRONMENT`, else `NODE_ENV` (`production` in the Docker image), else `development`.

## Logs

Logbook writes its logs to standard output.

- With `NODE_ENV=production`, as in the Docker image: one JSON object a line, from the `info` level. Otherwise readable lines from the `debug` level. `LOG_LEVEL` sets another level.
- Every line logged for a request, and for the work that request started after its answer, carries the request's id, so you can follow one click.
- Cookies, authorization headers, Slack's signature and query strings are left out.
- Client errors are logged as warnings, other errors with their stack.

## Uninstall and data retention

When a workspace uninstalls the app:
- the bot token is removed at once;
- the workspace's data is kept for `UNINSTALLED_DATA_RETENTION_DAYS` days (30 by default). Installing again within that time restores everything, with the members who joined meanwhile;
- after that, the data is deleted for good, one workspace at a time.

With `UNINSTALLED_DATA_RETENTION_DAYS=0` the data is deleted when the app is uninstalled.

## Backups

Logbook keeps everything in Postgres: the data of every workspace, the job queue and the migration history. Nothing on the app's host needs a backup, so back up the database.

- Supabase's paid plans back the database up. The free plan keeps no backups.
- Or back it up yourself with `pg_dump` over the session pooler connection string, the one in `DATABASE_URL`.

Keep `SLACK_TOKEN_ENCRYPTION_KEY` with your backups. The bot tokens in the database are encrypted with it: a database restored without the key works only after every workspace installs the app again.

## Known limitations

- Slack only; there is no Microsoft Teams support.
- No calendar sync (Google, Outlook) yet.
- Run a single instance. A second one beside it for a while, as in a zero-downtime deploy, is safe (see [One instance](#one-instance)).
- Time & Billing is in beta. Reports use the rates as they are now (only billing snapshots keep the rates they were made with), and changing the currency doesn't convert the rates. Logbook doesn't make invoices: a billing snapshot's CSV goes into your accounting tool.
