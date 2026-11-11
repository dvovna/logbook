# Changelog

Notable changes per release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may need a step when you update; its section says which.

## [Unreleased]

Company rules, and teams set up from a file. Update step: three database migrations, see Running it.

### Teams and approvers
- Company rules, opened from Teams: the level 2 approvers and their rule, who hears of decisions, and the vacation policy. A team follows them or keeps rules of its own, chosen in the team form; people in no team follow them. Level 1 always comes from the team.
- Teams → "Set up from a file": the bot sends a template with everyone's team and team lead, you fill it in and send it back as CSV or Excel, and it answers with a preview of what changes. Apply it within 7 days, and Undo it for 7 days after. For Admin and HR.
- When someone joins Slack after the app is set up, HR (the admins when nobody has the HR role) get a message asking which team they are on, with a list of teams and Not yet. The first answer places them and updates everyone's message; placing them any other way (the team form, People, the file) does too.
- Home's setup checklist now has the company rules and the team file as steps, and the welcome message to the installing admin lists the steps in the same order.

### Time tracking
- The Monday reminder of unsubmitted time goes out within 10 minutes of 09:00 UTC, a few messages a second per workspace so that Slack doesn't refuse them, and a workspace where it fails no longer keeps the others from getting theirs.

### Running it
- `DATABASE_POOL_SIZE` defaults to 10 (was 5), and the job queue holds 3 connections (was 2): together they must stay under your Supabase project's "Pool Size" (15 on the smaller compute sizes). A query that gets no connection within 2 seconds now fails instead of waiting.
- `JOBS_CONCURRENCY` (optional, default 4): how many background jobs run at once, so that a burst of them leaves connections to people's clicks.
- README → Self-hosting says why to run the app in the database's region.
- **Update step:** this release adds three database migrations (`20261112100000_company_rules.sql`, `20261112110000_team_file_uploads.sql`, `20261112120000_new_person_prompts.sql`). Apply them as 0.2.0 describes, with `pnpm supabase db push --remote "<connection string>"`; the app refuses to start without them.
- The `/user-team-mapping` command and `user-team-mapping.csv` are gone, replaced by the team file. Apply `slack-app-manifest.yml` again to drop the command from an installed app.
- HR may now share files with the bot (the team file); `user-vacations.csv` stays Admin only.

## [0.2.0] - 2026-11-10

A weekly timesheet and time off logged as time. Update step: two database migrations, see Running it.

### Time tracking
- My time shows a week: a table of every project with your time on each day, a status line, previous and next week, and "Submit week" for the week's drafts and rejected entries. A line counts the drafts and rejected entries of earlier weeks, with a button to the oldest of them; the rejection message and the Monday reminder name the week.
- Fill in a whole week, or a single day with a comment, in one form: a row per project (your recent ones, and any you add), one input per day. Time that waits for approval, is approved or is billed stays read-only, and a day changed since the form opened is refused instead of overwritten.
- After sending time for approval, the tab says how much went ("6 time entries (13h 30m) sent for approval").
- The week and day forms open and save well inside Slack's 3 seconds even with the database far away: a full week is read once and written in a few statements. Adding a project, showing the weekend and changing the day answer at once.

### Time off
- Time off as time: an admin picks a project per leave type and the hours of a working day on Projects, which shows what is set. An approved request then offers, in the requester's DM, to log one approved entry per working day on that project, described by its leave type ("Annual leave").
- Changing such a request's dates, status, type or person, or deleting it, removes that time again, except days already in a billing snapshot, which the notice names. Whoever logged the time gets a DM saying what happened to the time off and which hours were removed, in the same DM as the new offer when the request is still theirs; when HR gives the request to someone else, that person gets the offer in a DM of their own.
- Requesting time off closes the form and shows a notice on the tab instead of a Success screen.
- The requester hears about an approver's comment when it is made, with buttons to see the request or cancel it.
- Approvers' messages show the rejection reason, and lose their buttons when an admin deletes a pending request or a CSV import replaces it.
- A team's vacation policy is a required choice in the team form, with "No Policy" to take a policy away.
- HR's and admins' edits and deletions of time off answer faster: what they check is read at once, so Slack no longer gives up on them ("We had some trouble connecting") after they were saved.

### Running it
- **Update step:** this release adds two database migrations (`20261110171144_foreign_key_indexes.sql`, `20261111100000_time_off_logging.sql`). Apply them with `pnpm supabase db push --remote "<connection string>"` when you update (without `--remote` the CLI pushes to the local database); the app refuses to start without them.
- Every foreign key has an index, and uninstalled workspaces whose data is due to go are deleted one at a time, each in a transaction allowed to run longer than the usual 10-second statement timeout.
- Every Slack request finds its workspace and user in one query, and the app keeps an idle database connection for a minute (it closed it after 10 seconds) and sets a new one up in one statement instead of three: with the database in another region, each round trip costs about 100 ms and opening a connection most of a second.

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

[0.2.0]: https://github.com/dvovna/logbook/releases/tag/v0.2.0
[0.1.0]: https://github.com/dvovna/logbook/releases/tag/v0.1.0
