# Logbook

[![CI](https://github.com/dvovna/logbook/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/dvovna/logbook/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Logbook keeps your team's time in Slack: the hours people log and the days they take off. It's a Slack app for vacation requests and approvals, leave policies, holidays and time tracking. People request time off from the bot's App Home or with `/vacations`. The request goes to their managers and HR for approval. Admins and HR manage people, teams, policies and holidays without leaving Slack.

You can self-host it, and one deployment can serve many Slack workspaces.

**[Documentation](https://dvovna.github.io/logbook/docs/)**: how to use Logbook, set it up for your team, and run it yourself.

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

Run Logbook on your own server: a Supabase project, a Slack app from [`slack-app-manifest.yml`](slack-app-manifest.yml), and the Docker image `ghcr.io/dvovna/logbook`. The [self-hosting guide](https://dvovna.github.io/logbook/docs/self-hosting/install/) walks through it, and covers [updating](https://dvovna.github.io/logbook/docs/self-hosting/update/) and [running it](https://dvovna.github.io/logbook/docs/self-hosting/operate/) day to day. Read the version's section in [CHANGELOG.md](CHANGELOG.md) before an update.

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
