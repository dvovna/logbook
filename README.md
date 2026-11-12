# Logbook

[![CI](https://github.com/dvovna/logbook/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/dvovna/logbook/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Logbook keeps your team's time in Slack: the hours people log and the days they take off. It's a Slack app for vacation requests and approvals, leave policies, holidays and time tracking. People request time off from the bot's App Home or with `/vacations`. The request goes to their managers and HR for approval. Admins and HR manage people, teams, policies and holidays without leaving Slack.

You can self-host it, and one deployment can serve many Slack workspaces.

## Features

**Vacations**
- Request annual leave, sick leave, bonus days, unpaid leave and other time off from the App Home or with `/vacations request`.
- Overlapping dates are refused. You can cancel a pending request with `/vacations cancel`, and see your balance with `/vacations usage`.
- Two-level approval: the team's managers first, then the second level, such as HR, from the company rules or the team's own rules. Each level is approved by any one approver or by all of them.
- Approvers get a Slack message with Approve / Reject / Comment buttons. They can also decide in the App Home's Approvals inbox, which holds time off and time entries waiting for them. A rejection can say why, and the requester and the approvers' messages show the reason. The requester hears of an approver's comment when it is made.
- When an approver is away, HR or an admin can approve the waiting level for them, so the request moves on instead of getting stuck.
- When nobody on the team can approve a request (no team, no approvers, or the requester is the only one), it goes to HR, or to the admins when there is no HR. Nobody approves their own request.
- The requester and the team's notification recipients are told about the decision.

**Policies and balances**
- Vacation policies: vacation days, working days, bonus days, and the most days a person may carry over. The company rules name the policy for everyone; a team can keep its own instead. Unused days carry over to the next year on their own, up to the policy's limit; for the year a person joins, HR enters what they bring on their profile.
- The vacation year runs from the employee's contract start date, or over the calendar year when the employee has none.
- Calendar and working days are counted separately. Working days skip weekends and the policy's holidays.
- Public holidays can be imported per country (from [Nager.Date](https://date.nager.at)), with a region's own holidays if you choose one. You can add company holidays and turn individual ones off.
- No-setup mode: without a policy, the bot just keeps track of time off and enforces no limits.

**People**
- When the app is installed, all workspace members are imported; people who join later are added automatically.
- Roles: admin, HR, manager, finance, member. Finance handles rates, billing reports and snapshots, and sees everyone's time in reports; it approves nothing and manages no people.
- Admins upload a CSV to bulk-load vacation history.
- Admin and HR set up teams from a file the bot sends. They fill it in and share it back, check the preview, then apply it. Undo restores it for 7 days.

**Time & Billing (beta)**
- Clients, projects with team and user assignments, and billable flags.
- Hourly rates: a project's rate, and a person's own rate on a project that replaces it. One currency per workspace, which an admin sets. Only admins and finance see rates and amounts.
- Time entries in 15-minute steps, logged from the App Home or with `/log` as drafts, and then submitted for approval.
- My time shows the week as a table of projects by day, with previous and next week and "Submit week". One form fills in a week, or a day with a comment, across your projects.
- Time off as time: admins map each leave type to a project and set the hours of a working day; an approved request then offers to log its working days as approved time on that project.
- The team's managers, HR or an admin approve or reject submitted time; a rejection tells the owner why.
- Time reports for a period, by client, project, person or team: hours, billable and approved time, and for admins and finance the amounts. Admins, HR and finance see everyone's time, managers their teams' and their own, everyone else their own. A quick period (this or last week, month, quarter) fills the dates, and the report and its CSV can be narrowed to a client, a project or a person.
- "Who hasn't submitted": the people a manager, HR, finance or an admin sees who logged nothing in a period, or still have drafts or rejected time in it.
- A CSV of a time report's entries, sent to you as a file in a DM: date, person, email, team, client, project, description, hours, billable, status, and for admins and finance the rate and the amount (comma-separated UTF-8).
- A billing report per client and period, from approved time: each person's hours on each project with the rate and the amount, the totals by project and by person, and the amount in all. Billable time without a rate has no amount and is counted apart. Billing reports, snapshots and the uninvoiced report are for admins and finance.
- Billing snapshots: admins and finance lock a billing report's approved time with today's rates, for an invoice you make elsewhere (Logbook makes no invoices). Nobody can change the time in a snapshot. A snapshot's CSV is sent to you in a DM (date, person, email, team, project, description, hours, billable, rate, amount, currency), and you mark it invoiced (or not invoiced again). The list filters by client. An admin can unlock a snapshot to correct its time, which deletes it.
- An uninvoiced report per client, for all time or a period: approved billable time in no snapshot, with its amount at today's rates, and the time of snapshots not marked invoiced yet.
- Admins and HR see everyone's time logs.

## How it works

- A NestJS app that receives Slack events, slash commands and interactions over HTTPS. It verifies Slack's signature on every request.
- Data is stored in [Supabase](https://supabase.com) Postgres. The app connects to the database directly (`DATABASE_URL`) and doesn't use Supabase's REST API, which stays closed. The schema is in `supabase/migrations`.
- Every Slack workspace that installs the app through OAuth gets its own row in `slack_teams`. All other data is scoped to it. Uninstalling the app removes the bot token at once and deletes the data after `UNINSTALLED_DATA_RETENTION_DAYS` (30 by default); installing again before then restores it.

[CLAUDE.md](CLAUDE.md) describes the architecture in more detail.

## Self-hosting

You need:
- the source of the release you run, for its database migrations: `git clone --branch v0.3.0 https://github.com/dvovna/logbook && cd logbook && pnpm install` (with pnpm 10, `npm install -g pnpm@10`; the steps below run the Supabase CLI pinned in it);
- a Supabase project. The free plan runs the bot, but it keeps no backups and Supabase pauses it after a week of little activity (see [Run](#4-run)). For a company's real data, take a paid plan or back the database up yourself, e.g. with `pg_dump` over the session pooler connection string;
- a host that runs Docker or Node 26, reachable from Slack over HTTPS;
- permission to create a Slack app in your workspace.

### 1. Database

Create a Supabase project and apply the migrations:

```bash
pnpm supabase db push --remote "postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres"
```

Take the session pooler connection string from the project's "Connect" dialog. The direct `db.<project-ref>.supabase.co` host is IPv6-only. The app connects with the same string (`DATABASE_URL` below).

Run the app in the project's region. Every SQL statement is a round trip to the database, and a click such as saving a week or approving a request sends up to ten of them one after another before the app answers. A round trip takes about a millisecond within a region and about 100 ms between regions. Far from its database, the app spends up to a second of the 3 that Slack waits on the database alone, and every statement holds one of the pooler's few connections a hundred times longer, so the whole installation manages only a few clicks a second.

### 2. Slack app

1. Replace `APP_DOMAIN` in [`slack-app-manifest.yml`](slack-app-manifest.yml) with the domain the bot will run on:
   ```bash
   sed 's/APP_DOMAIN/vacations.example.com/g' slack-app-manifest.yml
   ```
2. Create the app from the result at https://api.slack.com/apps ("Create New App" → "From a manifest"). The manifest turns on token rotation: bot tokens expire after 12 hours and the app refreshes them, so a token that leaks is soon useless. Slack can't turn rotation off again for an app.
3. To install it into other workspaces too, turn on public distribution in "Manage Distribution". Share `https://<your-domain>/api/slack/install` as the install link; see below. Without public distribution only your own workspace can install it, which is what a single company wants: with it, any Slack workspace that has the link can install the app on your server, unless you list the allowed ones in `ALLOWED_SLACK_TEAM_IDS`.

### 3. Configuration

Copy [`.env.example`](.env.example) to `.env` and fill it in:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The session pooler connection string from step 1 (port 5432, not 6543). The app reads and writes all its data over it, and the job queue, which retries Slack messages and workflow steps that failed, keeps its own `pgboss` schema there. The app doesn't use the Supabase API or its keys. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack app → Basic Information |
| `SLACK_SIGN_IN_SECRET` | Slack app → Basic Information → Signing Secret |
| `SLACK_REDIRECT_URI` | `https://<your-domain>/api/slack/oauth/redirect` |
| `SLACK_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts the bot tokens in the database. Keep it with your other secrets: without it the app can't read the tokens, and every workspace has to install the app again. |
| `PORT` | Port to listen on: 3000 in `.env.example`, and 3000 when it's unset, except in the Docker image, which sets 10000. |
| `ALLOWED_SLACK_TEAM_IDS` | Optional. Comma-separated Slack workspace IDs (`T…`) that may install the app on your server. Any other workspace gets a refusal, and its token is revoked. Unset, every workspace with the install link may install. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Optional. Sends unexpected errors to your Sentry project: the error and its stack, no request data or people's details. Empty sends nothing anywhere. |
| `DATABASE_POOL_SIZE` | Optional, default 10. Connections the app's pool may hold; the job queue holds 3 more. Together they must stay under the Supabase project's "Pool Size" (15 on the smaller compute sizes), the connections the session pooler allows at once for all its clients: 10 + 3 leaves 2 for `supabase db push` or `psql`. A query that finds no free connection within 2 seconds fails, and Slack shows an error instead of waiting for nothing. |
| `JOBS_CONCURRENCY` | Optional, default 4. How many background jobs (messages, approval steps, imports, reminders) run at once; the others wait their turn, saved in the database, so a restart loses none. Keep it well under `DATABASE_POOL_SIZE`, so that a burst such as the Monday reminder leaves connections to the clicks people wait on. |

The per-user and per-workspace limits (`MAX_*`) have defaults; `.env.example` lists them.

### 4. Run

The image is on GitHub Container Registry for amd64 and arm64, tagged with each version (`0.3.0`), its minor line (`0.3`) and `latest`:

```bash
docker run -d --name logbook --restart always --stop-timeout 30 --env-file .env -p 3000:3000 ghcr.io/dvovna/logbook:0.3
```

The second port of `-p` is `PORT` from `.env`; with `PORT` left out of `.env`, the container listens on 10000, so map `-p 3000:10000`.

Or with the compose file, which runs the same image (`LOGBOOK_VERSION` picks the tag, `latest` by default):

```bash
docker compose up -d
```

`docker compose up -d --build` builds the image from your checkout instead. Or without Docker:

```bash
pnpm install
pnpm build
pnpm start:prod
```

Put the app behind HTTPS (a reverse proxy, or a platform such as Render or Fly.io). Then open "Event Subscriptions" in the Slack app settings and retry the URL verification.

On a restart or a deploy the app gets SIGTERM: it stops taking requests at once, finishes what is in flight (an approval, a CSV on its way) for up to 12 seconds, then closes its connections, in 22 seconds at most. `docker stop` kills a container after 10 seconds, so the compose file sets `stop_grace_period: 30s` and the `docker run` above passes `--stop-timeout 30`. A platform has its own grace period: set it to 30 seconds, e.g. `maxShutdownDelaySeconds` in Render's `render.yaml` or `kill_timeout` in Fly.io's `fly.toml`. Work cut off by a shorter one isn't lost, since the next process retries it, but it comes minutes late.

`GET /health` answers 200 while the app reaches its database and 503 when it can't; point your platform's health check at it. The Docker image already uses it.

On Supabase's free plan the health check also keeps the project awake. Supabase pauses a free project after 7 days of little activity. A quiet week, such as the New Year holidays, is enough, and then the bot stops answering until someone restores the project in the Supabase dashboard. Every `/health` call runs a query on the database, and Supabase counts database activity. So make sure something calls it regularly: the image's `HEALTHCHECK` does it every 30 seconds under Docker, but some platforms ignore it and need their own health check pointed at `/health`.

### 5. Install

Open `https://<your-domain>/api/slack/install` in the browser and approve the app. The link starts the OAuth flow with a one-time `state` bound to your browser, so only an installation started there can finish.

Don't use "Install to Workspace" in the app settings, and don't use the sharable URL Slack generates. Both skip the `state`, so the bot refuses them and the workspace is never created. When you distribute the app, give out the `/api/slack/install` link.

The person who installs the app becomes its admin. The other members are imported a few seconds later. Installing it again later (for example after an update adds scopes) only replaces the bot token: data and roles stay as they are.

The CSV export needs the `files:write` scope, which the manifest got after the first installs. If your Slack app was created from an older manifest, add `files:write` under "OAuth & Permissions" → "Bot Token Scopes" (or update the app from the current manifest), then install the app again in every workspace through `/api/slack/install`. Until a workspace does, the export answers with a DM that asks for it. Uninstalling the app removes its bot token at once and keeps the workspace's data for `UNINSTALLED_DATA_RETENTION_DAYS` days (30 by default; 0 deletes it at once): installing again within that time restores everything, with the members who joined meanwhile. After it, the data is deleted for good. Then, in the App Home:
- create vacation policies and their holidays under More → Policies;
- give approvers the Manager or HR role under More → People;
- create teams, their members and approvers under More → Teams.

The installer gets a message with these steps, and Home shows admins and HR a checklist until they are done.

### Updating

An app created before token rotation keeps working with its tokens, which never expire. To switch to rotating tokens, turn on "Advanced token security via token rotation" under "OAuth & Permissions" and install the app again in each workspace: the new install gets a rotating token.

Read the version's section in [CHANGELOG.md](CHANGELOG.md) first: it says when an update needs a step of its own. Check out the new release's tag, run `pnpm install`, apply the new migrations with `pnpm supabase db push --remote "<the same connection string>"`. Without `--remote` the CLI pushes to the local database. Apply the migrations before the new version starts: it checks the database at startup and refuses to start, naming the missing migrations, until they are applied. Then run the new image (`docker compose pull && docker compose up -d`, with `LOGBOOK_VERSION` set to the new version if you pin one).

### Checking the database is closed

The app reaches the database only through `DATABASE_URL`. The `anon` and `authenticated` roles of the Supabase API get no access to its tables and functions. After changing the schema outside the migrations (for example in Studio), check that this still holds; every query should return no rows:

```sql
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute')
   or has_function_privilege('authenticated', p.oid, 'execute'));
```

## Development

You need Node 26 (pinned in `.nvmrc`, so `nvm use` picks it up), pnpm 10 (`npm install -g pnpm@10`) and Docker.

```bash
pnpm install
pnpm start:dev     # watch mode
```

### Local database

The app needs only Postgres, but the migrations grant to and revoke from Supabase's roles, so it runs on the Supabase stack. `supabase/config.toml` starts a local one with Postgres, the API and Studio enabled:

```bash
pnpm supabase start
```

On the first start the migrations from `supabase/migrations` create the schema. `pnpm db:init` (`supabase db reset`) drops the local database and applies them again, for example after pulling new migrations.

In `.env`:
- set `SLACK_TOKEN_ENCRYPTION_KEY` to the output of `openssl rand -base64 32`;
- set `DATABASE_URL` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

Studio is at http://127.0.0.1:54323. `pnpm supabase stop` stops the stack and keeps the data.

### Dev Slack app

1. Start a tunnel. A static domain (the free ngrok plan has one) keeps the Slack URLs the same between restarts:
   ```bash
   ngrok http 3000 --url=<your-domain>
   ```
2. Create a separate app from `slack-app-manifest.yml`, with `APP_DOMAIN` replaced by your ngrok domain. An app has one set of request URLs, so keep it apart from the production app.
3. Fill in the Slack values in `.env`.
4. Run `pnpm start:dev`.
5. Install the app by opening `https://<your-ngrok-domain>/api/slack/install`, as described above.

To go through an approval you need at least two people in the workspace: one requests a vacation, the other approves it.

### Sending events without Slack

`pnpm slack:event` posts a payload to the running app, signed with `SLACK_SIGN_IN_SECRET` from `.env`. This lets you check event handlers without Slack or ngrok.

Sample payloads are in `src/commands/slack-events/`. They use `T_LOCAL` as the workspace ID; `--team` replaces it with the `slack_id` of a workspace from the `slack_teams` table:

```bash
pnpm slack:event src/commands/slack-events/url-verification.json
pnpm slack:event src/commands/slack-events/team-join.json --team T0123ABCD
```

`--url` sends the payload elsewhere, e.g. through the tunnel.

## Tests

```bash
pnpm test          # unit tests
pnpm test:int      # integration tests, need the local Supabase stack
pnpm test:cov:all  # both, with their coverage merged into coverage/index.html
npx tsc --noEmit
```

Coverage means little for one suite alone: unit tests leave the Slack UI out, and integration tests replace the Slack and Nager.Date clients with fakes. `pnpm test:cov:all` (`jest.coverage.config.ts`) runs both as Jest projects in one run and reports what they cover together; it needs the local stack like `pnpm test:int`.

`test/integration` runs the whole app against the local Supabase stack, with the real `AppModule` and the request pipeline from `main.ts`. Only the Slack Web API is replaced: `SlackApiClient` is swapped for a fake that records every call. The tests:
- send signed Slack requests to the real routes: events, slash commands, interactions, external select options and the OAuth redirect;
- fill modals from the view the app actually opened;
- check the database and the calls the app made to Slack;
- fail on anything Slack would refuse: a view or message it would not accept, errors for fields a modal does not have, or an answer later than Slack's 3 seconds.
- fail on what Slack accepts but shows otherwise than meant: more than five buttons in a row (Slack folds the rest into "+ N more"), a ⋯ menu with one option, two dividers in a row, Markdown in `mrkdwn` text or formatting in `plain_text`. A look at the real Slack that finds something like this adds a rule to `support/block-kit-display-rules.ts`.
- fail when an action people wait on (the week and day forms, My time, an edit of time off) takes more round trips one after another to the database before its answer than `round-trips.int-spec.ts` allows (or a few statements more than today). Far from its database (a laptop and Supabase in another region) a round trip costs about 100 ms.

Each test starts on a fixed date (Wednesday 2026-06-17), waits for the work the app does after answering Slack with `await t.idle()` instead of polling, and reads tabs through `support/tab-readers.ts` (list items, sections, buttons) rather than searching their JSON.

Rules for the integration tests:
- Start the local stack first. If the local database is missing a migration, the run stops and says how to apply it.
- The tests take the database URL from `supabase status`, never from `.env`, and refuse to run against anything but localhost.
- Each test creates its own workspace (a `slack_teams` row with a random `T…` ID) and deletes it at the end. The foreign keys cascade, so nothing is left behind and your local data is not touched.

```bash
pnpm test:int test/integration/vacation-approval.int-spec.ts   # one file
LOG_LEVEL=debug pnpm test:int                                  # with the app's logs
SQL_LATENCY_MS=100 pnpm test:int test/integration/timesheet.int-spec.ts   # every query 100 ms later, as far from the database
```

A bug a test has found but nobody has fixed yet stays in the suite as `it.failing`, with a `BUG:` comment that points at the code. Such a test passes while the bug is there and fails once it is fixed; then make it a plain `it`.

CI runs the type check, lint, unit and integration tests on every pull request, and checks that `src/common/types/database.types.ts` matches the migrations.

### Load test

`pnpm test:load` (`test/load/monday-peak.load-spec.ts`) checks that Logbook answers Slack within its 3 seconds at the Monday peak of a company of 400 people. It is not part of `pnpm test:int` or CI. It uses the integration tests' app, fake Slack and safeguards (the local stack only), and:
- seeds a workspace of 400 people in 20 teams with a year of time, about 150,000 entries (`insert … select generate_series`, `test/load/support/seed.ts`): approved up to last week, whose time is still in drafts for 6 people in 10 and waits for approval for 3 in 10;
- on Monday 09:00 starts the weekly reminder and, three times 10 seconds apart, a burst of 80 clicks at once: people opening Home, opening last week's form, saving and submitting it, managers opening Approvals, two time reports of the year and a CSV of the year;
- makes every statement 100 ms slower and every Slack call 150 ms, with production's pool (10 connections) and 4 jobs at once;
- prints the answer times (p50, p95, max) by kind of click, how long people waited for their screen or file, the waits for a pool connection and the event loop's delay, and fails on an answer over 2.5 s, an error the app logged, or a screen that never showed.

It takes a few minutes and deletes its workspace at the end. With the database 100 ms away it doesn't pass yet: the work after the answers takes the pool from the clicks (dvovna/logbook#94). With the database in the app's region (`SQL_LATENCY_MS=1`) it does.

```bash
pnpm test:load
SQL_LATENCY_MS=1 pnpm test:load                       # the app next to its database
LOAD_SCALE=2 DATABASE_POOL_SIZE=20 pnpm test:load     # twice the clicks, a bigger pool
LOAD_REPORT=load.json pnpm test:load                  # the numbers as JSON too
```

`SLACK_LATENCY_MS`, `JOBS_CONCURRENCY`, `LOAD_WAVES` and `LOAD_WAVE_GAP_MS` change the rest. The app, the test client and the fake Slack share one Node process, so the event loop's delay counts the client's work too.

## Known limitations

- Slack only; there is no Microsoft Teams support.
- No calendar sync (Google, Outlook) yet.
- Run a single instance. A second one beside it for a while, as in a zero-downtime deploy, is safe: they share the bot token and the daily work through the database. Each keeps its own caches, jobs and database connections, which count against your database's connection limit together.
- Time & Billing is in beta. Reports use the rates as they are now (only billing snapshots keep the rates they were made with), and changing the currency doesn't convert the rates. Logbook doesn't make invoices: a billing snapshot's CSV goes into your accounting tool.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a service for others, you have to make its source available to them.
