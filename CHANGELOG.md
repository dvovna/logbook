# Changelog

Notable changes per release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may need a step when you update; its section says which.

## [Unreleased]

### Time tracking
- My time shows a week: a table of every project with your time on each day, a status line, previous and next week, and "Submit week" for the week's drafts and rejected entries. A line counts the drafts and rejected entries of earlier weeks, with a button to the oldest of them; the rejection message and the Monday reminder name the week.
- Fill in a whole week, or a single day with a comment, in one form: a row per project (your recent ones, and any you add), one input per day. Time that waits for approval, is approved or is billed stays read-only, and a day changed since the form opened is refused instead of overwritten.
- The week and day forms open and save well inside Slack's 3 seconds even with the database far away: a full week is read once and written in a few statements. Adding a project, showing the weekend and changing the day answer at once.

### Time off
- Time off as time: an admin picks a project per leave type and the hours of a working day on Projects, which shows what is set. An approved request then offers, in the requester's DM, to log one approved entry per working day on that project, described by its leave type ("Annual leave"). Changing the request's dates, status, type or person, or deleting it, removes that time again, except days already in a billing snapshot, which the notice names; the requester gets a DM of what was removed, together with the new offer when there is one.
- HR's and admins' edits and deletions of time off answer faster: what they check is read at once, so Slack no longer gives up on them ("We had some trouble connecting") after they were saved.

### Running it
- Every Slack request finds its workspace and user in one query, and the app keeps an idle database connection for a minute (it closed it after 10 seconds) and sets a new one up in one statement instead of three: with the database in another region, each round trip costs about 100 ms and opening a connection most of a second.
- This release adds a database migration (`20261111100000_time_off_logging.sql`). Apply it with `pnpm supabase db push --remote "<connection string>"` when you update (without `--remote` the CLI pushes to the local database); the app refuses to start without it.

## [0.1.0] - 2026-11-10

The first release. A self-hosted Slack app, one deployment for one or more workspaces.

### Time off
- Annual leave, sick leave, bonus days, unpaid leave and other time off, requested from the App Home or with `/vacations`.
- Approval in two levels (the team's managers, then HR), each by any one approver or by all of them. Approvers decide in a Slack message or in the Approvals inbox, and a rejection can say why. HR and admins can approve a waiting level for approvers who are away.
- A request nobody on the team can approve goes to HR, or to the admins; nobody approves their own request.
- Vacation policies per team (vacation, working and bonus days, carryover), a year that runs from the contract start, public holidays per country from Nager.Date and company holidays. Without a policy the app only keeps track.

### Time tracking
- Time in 15-minute steps, logged from the App Home or with `/log`, as drafts submitted for approval.
- Clients and projects, assigned to teams and people, billable or not, with an hourly rate per project and per person on a project, in one currency per workspace.
- Approval by the team's managers. Entries nobody on the team approves (no team, no manager, or the only manager's own) wait for HR, or for the admins; HR and admins can still decide anyone's from All pending entries. A rejection tells the owner why.
- Approvers get a DM of what was submitted to them. On Monday, people with drafts or rejected entries from before the week get a reminder.
- Time reports by client, project, person or team, each role seeing its own scope, narrowed by client, project or person, "who hasn't submitted", and a CSV of the entries sent in a DM (needs the `files:write` scope). Report forms fill their dates from a quick period.
- A billing report of approved time per client and period.
- Billing snapshots: a client's approved time of a period, locked with its rates and amounts, sent as a CSV in a DM and marked invoiced; an admin can unlock one. An uninvoiced report per client.

### Roles
- Admin, HR (people and time off), Manager (approves their teams' time off and time), Finance (rates, billing reports, snapshots and the uninvoiced report, without managing people or approving) and Member. Only an admin grants or removes Admin or Finance.

### App Home
- Navigation in one row: Home, My time, Time off, Approvals and a More menu with People, Reports and the Settings screens (Teams, Policies, Projects, Clients), each shown to the roles that may use it.
- Home says what waits for the viewer's decision, and shows Admin and HR a setup checklist until the workspace has a policy, a team with approvers and everyone in a team. Forms close and the screen says what happened.

### Running it
- Docker image for amd64 and arm64 on GitHub Container Registry, a health check at `/health`, and a startup check that the database has every migration.
- Bot tokens encrypted at rest and rotated every 12 hours (Slack token rotation).
- An uninstalled workspace's data is kept for 30 days, so that installing again restores it, then deleted (`UNINSTALLED_DATA_RETENTION_DAYS`).
- Needs only a Postgres connection (`DATABASE_URL`, on Supabase the session pooler), no Supabase API keys. Changes that belong together, with the jobs that follow them, are saved in one transaction.
- A job queue on Postgres that retries Slack messages and workflow steps, and optional error reports to Sentry with no personal data.
- CSV imports of vacation history and team membership.
- The workspace's members are imported on install and synced once a day, so someone whose join Slack never delivered still comes in.

[0.1.0]: https://github.com/dvovna/logbook/releases/tag/v0.1.0
