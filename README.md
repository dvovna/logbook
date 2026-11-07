# Logbook

[![CI](https://github.com/dvovna/logbook/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/dvovna/logbook/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Logbook keeps your team's time in Slack: the hours people log and the days they take off. It's a Slack app for vacation requests and approvals, leave policies, holidays and time tracking. People request time off from the bot's App Home or with `/vacations`. The request goes to their managers and HR for approval. Admins and HR manage people, teams, policies and holidays without leaving Slack.

You can self-host it, and one deployment can serve many Slack workspaces.

## Features

**Vacations**
- Request annual leave, sick leave, bonus days, unpaid leave and other time off from the App Home or with `/vacations request`.
- Overlapping dates are refused. You can cancel a pending request with `/vacations cancel`, and see your balance with `/vacations usage`.
- Two-level approval: the team's managers first, then HR. Each level is approved by any one approver or by all of them.
- Approvers get a Slack message with Approve / Reject / Comment buttons. They can also decide in the App Home's Approvals inbox, which holds time off and time entries waiting for them. A rejection can say why, and the requester sees the reason.
- When an approver is away, HR or an admin can approve the waiting level for them, so the request moves on instead of getting stuck.
- When nobody on the team can approve a request (no team, no approvers, or the requester is the only one), it goes to HR, or to the admins when there is no HR. Nobody approves their own request.
- The requester and the team's notification recipients are told about the decision.

**Policies and balances**
- Vacation policies per team: vacation days, working days, bonus days, plus carryover per user.
- The vacation year runs from the employee's contract start date, or over the calendar year when the employee has none.
- Calendar and working days are counted separately. Working days skip weekends and the policy's holidays.
- Public holidays can be imported per country (from [Nager.Date](https://date.nager.at)). You can add company holidays and turn individual ones off.
- No-setup mode: without a policy, the bot just keeps track of time off and enforces no limits.

**People**
- When the app is installed, all workspace members are imported; people who join later are added automatically.
- Roles: admin, HR, manager, member.
- Admins upload CSV files to bulk-load vacation history and team membership.

**Time & Billing (beta)**
- Clients, projects with team and user assignments, and billable flags.
- Time entries in 15-minute steps, logged from the App Home or with `/log` as drafts, and then submitted for approval.
- The team's managers, HR or an admin approve or reject submitted time; a rejection tells the owner why.
- A billing report per client and period, from approved time.
- Admins and HR see everyone's time logs.

## How it works

- A NestJS app that receives Slack events, slash commands and interactions over HTTPS. It verifies Slack's signature on every request.
- Data is stored in [Supabase](https://supabase.com) (Postgres plus its REST API). The schema is in `supabase/migrations`.
- Every Slack workspace that installs the app through OAuth gets its own row in `slack_teams`. All other data is scoped to it, and uninstalling the app deletes it.

[CLAUDE.md](CLAUDE.md) describes the architecture in more detail.

## Self-hosting

You need:
- a clone of this repository with its dependencies (`yarn install`): the steps below run the Supabase CLI pinned in it;
- a Supabase project (the free tier is enough);
- a host that runs Docker or Node 26, reachable from Slack over HTTPS;
- permission to create a Slack app in your workspace.

### 1. Database

Create a Supabase project and apply the migrations:

```bash
yarn supabase db push --remote "postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres"
```

Take the session pooler connection string from the project's "Connect" dialog. The direct `db.<project-ref>.supabase.co` host is IPv6-only.

### 2. Slack app

1. Replace `APP_DOMAIN` in [`slack-app-manifest.yml`](slack-app-manifest.yml) with the domain the bot will run on:
   ```bash
   sed 's/APP_DOMAIN/vacations.example.com/g' slack-app-manifest.yml
   ```
2. Create the app from the result at https://api.slack.com/apps ("Create New App" → "From a manifest").
3. To install it into other workspaces too, turn on public distribution in "Manage Distribution". Share `https://<your-domain>/api/slack/install` as the install link; see below. Without public distribution only your own workspace can install it, which is what a single company wants: with it, any Slack workspace that has the link can install the app on your server, unless you list the allowed ones in `ALLOWED_SLACK_TEAM_IDS`.

### 3. Configuration

Copy [`.env.example`](.env.example) to `.env` and fill it in:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Project URL (Project Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` key. It bypasses row-level security, so keep it on the server only. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack app → Basic Information |
| `SLACK_SIGN_IN_SECRET` | Slack app → Basic Information → Signing Secret |
| `SLACK_REDIRECT_URI` | `https://<your-domain>/api/slack/oauth/redirect` |
| `SLACK_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts the bot tokens in the database. Keep it with your other secrets: without it the app can't read the tokens, and every workspace has to install the app again. |
| `PORT` | Port to listen on. The Docker image defaults to 10000. |
| `ALLOWED_SLACK_TEAM_IDS` | Optional. Comma-separated Slack workspace IDs (`T…`) that may install the app on your server. Any other workspace gets a refusal, and its token is revoked. Unset, every workspace with the install link may install. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Optional. Sends unexpected errors to your Sentry project: the error and its stack, no request data or people's details. Empty sends nothing anywhere. |
| `DATABASE_URL` | Optional. A direct Postgres connection for the job queue, which retries Slack messages and workflow steps that failed. On Supabase use the session pooler string from "Connect" (port 5432, not 6543). The queue creates its own `pgboss` schema there on the first start. Without it the app runs those once and logs failures. |

The per-user and per-workspace limits (`MAX_*`) have defaults; `.env.example` lists them.

### 4. Run

```bash
docker compose up -d --build
```

Or without Docker:

```bash
yarn install
yarn build
yarn start:prod
```

Put the app behind HTTPS (a reverse proxy, or a platform such as Render or Fly.io). Then open "Event Subscriptions" in the Slack app settings and retry the URL verification.

`GET /health` answers 200 while the app reaches its database and 503 when it can't; point your platform's health check at it. The Docker image already uses it.

### 5. Install

Open `https://<your-domain>/api/slack/install` in the browser and approve the app. The link starts the OAuth flow with a one-time `state` bound to your browser, so only an installation started there can finish.

Don't use "Install to Workspace" in the app settings, and don't use the sharable URL Slack generates. Both skip the `state`, so the bot refuses them and the workspace is never created. When you distribute the app, give out the `/api/slack/install` link.

The person who installs the app becomes its admin. The other members are imported a few seconds later. Installing it again later (for example after an update adds scopes) only replaces the bot token: data and roles stay as they are. Uninstalling the app deletes all of the workspace's data at once. Then, in the App Home:
- set up teams and their approvers under People;
- set up vacation policies and holidays under Vacations.

### Updating

Pull the new version, run `yarn install`, apply the new migrations with `yarn supabase db push --remote "<the same connection string>"`, and redeploy. Without `--remote` the CLI pushes to the local database. Apply the migrations before the new version starts: it checks the database at startup and refuses to start, naming the missing migrations, until they are applied.

### Checking the database is closed

The app reaches the database only with the service role key. The `anon` and `authenticated` roles of the Supabase API get no access to its tables and functions. After changing the schema outside the migrations (for example in Studio), check that this still holds; every query should return no rows:

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

You need Node 26 (pinned in `.nvmrc`, so `nvm use` picks it up), yarn 1 and Docker.

```bash
yarn install
yarn start:dev     # watch mode
```

### Local database

The app reads and writes through the Supabase API, so a plain Postgres is not enough. `supabase/config.toml` starts a local stack with only Postgres, the API and Studio enabled:

```bash
yarn supabase start
```

On the first start the migrations from `supabase/migrations` create the schema. `yarn db:init` (`supabase db reset`) drops the local database and applies them again, for example after pulling new migrations.

In `.env`:
- set `SUPABASE_URL` to `API_URL` from `yarn supabase status -o env`;
- set `SUPABASE_SERVICE_ROLE_KEY` to `SERVICE_ROLE_KEY` from the same output;
- set `SLACK_TOKEN_ENCRYPTION_KEY` to the output of `openssl rand -base64 32`;
- optionally, to try the job queue, set `DATABASE_URL` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

Studio is at http://127.0.0.1:54323. `yarn supabase stop` stops the stack and keeps the data.

### Dev Slack app

1. Start a tunnel. A static domain (the free ngrok plan has one) keeps the Slack URLs the same between restarts:
   ```bash
   ngrok http 3000 --url=<your-domain>
   ```
2. Create a separate app from `slack-app-manifest.yml`, with `APP_DOMAIN` replaced by your ngrok domain. An app has one set of request URLs, so keep it apart from the production app.
3. Fill in the Slack values in `.env`.
4. Run `yarn start:dev`.
5. Install the app by opening `https://<your-ngrok-domain>/api/slack/install`, as described above.

To go through an approval you need at least two people in the workspace: one requests a vacation, the other approves it.

### Sending events without Slack

`yarn slack:event` posts a payload to the running app, signed with `SLACK_SIGN_IN_SECRET` from `.env`. This lets you check event handlers without Slack or ngrok.

Sample payloads are in `src/commands/slack-events/`. They use `T_LOCAL` as the workspace ID; `--team` replaces it with the `slack_id` of a workspace from the `slack_teams` table:

```bash
yarn slack:event src/commands/slack-events/url-verification.json
yarn slack:event src/commands/slack-events/team-join.json --team T0123ABCD
```

`--url` sends the payload elsewhere, e.g. through the tunnel.

## Tests

```bash
yarn test          # unit tests
yarn test:int      # integration tests, need the local Supabase stack
npx tsc --noEmit
```

`test/integration` runs the whole app against the local Supabase stack, with the real `AppModule` and the request pipeline from `main.ts`. Only the Slack Web API is replaced: `SlackApiClient` is swapped for a fake that records every call. The tests:
- send signed Slack requests to the real routes: events, slash commands, interactions, external select options and the OAuth redirect;
- fill modals from the view the app actually opened;
- check the database and the calls the app made to Slack;
- fail on anything Slack would refuse: a view or message it would not accept, errors for fields a modal does not have, or an answer later than Slack's 3 seconds.

Each test starts on a fixed date (Wednesday 2026-06-17), waits for the work the app does after answering Slack with `await t.idle()` instead of polling, and reads tabs through `support/tab-readers.ts` (list items, sections, buttons) rather than searching their JSON.

Rules for the integration tests:
- Start the local stack first. If the local database is missing a migration, the run stops and says how to apply it.
- The tests take their Supabase URLs and keys from `supabase status`, never from `.env`, and refuse to run against anything but localhost.
- Each test creates its own workspace (a `slack_teams` row with a random `T…` ID) and deletes it at the end. The foreign keys cascade, so nothing is left behind and your local data is not touched.

```bash
yarn test:int test/integration/vacation-approval.int-spec.ts   # one file
LOG_LEVEL=debug yarn test:int                                  # with the app's logs
```

A bug a test has found but nobody has fixed yet stays in the suite as `it.failing`, with a `BUG:` comment that points at the code. Such a test passes while the bug is there and fails once it is fixed; then make it a plain `it`.

CI runs the type check, lint, unit and integration tests on every pull request, and checks that `src/common/types/database.types.ts` matches the migrations.

## Known limitations

- Slack only; there is no Microsoft Teams support.
- No calendar sync (Google, Outlook) yet.
- Caches are in memory, so run a single instance.
- Time & Billing is in beta.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). If you run a modified version as a service for others, you have to make its source available to them.
