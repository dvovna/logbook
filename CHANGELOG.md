# Changelog

Notable changes per release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may need a step when you update; its section says which.

## [Unreleased]

### Running it
- Errors sent to Sentry carry the release they came from (`logbook@<version>`), so an issue shows which version brought it.
- A process stopped while it was still starting (a quick redeploy or restart) no longer reports the failed start to Sentry, and a start that really fails exits with code 1 instead of staying up without a port when Sentry is set.
- The Docker image (and `pnpm start:prod`) runs Node with source maps, so stack traces in the logs and in Sentry name the TypeScript file and line instead of the compiled JavaScript.

## [0.3.0] - 2026-11-12

Company rules and teams set up from a file, approval levels that no longer get stuck, balances and holidays counted for the right year, and an app that holds up with hundreds of people per workspace. Update step: six database migrations and the app manifest, see Running it.

### Teams and approvers
- Company rules, opened from Teams: the level 2 approvers and their rule, who hears of decisions, and the vacation policy. A team follows them or keeps rules of its own, chosen in the team form; people in no team follow them. Level 1 always comes from the team.
- Teams → "Set up from a file": the bot sends a template with everyone's team and team lead, you fill it in and send it back as CSV or Excel, and it answers with a preview of what changes. Apply it within 7 days, and Undo it for 7 days after. For Admin and HR.
- When someone joins Slack after the app is set up, HR (the admins when nobody has the HR role) get a message asking which team they are on, with a list of teams and Not yet. The first answer places them and updates everyone's message; placing them any other way (the team form, People, the file) does too.
- Home's setup checklist now has the company rules and the team file as steps, and the welcome message to the installing admin lists the steps in the same order.

### Time off
- A request is checked against the balance of the vacation year it falls in, not the current one, and an edit no longer counts it twice against the balance.
- A vacation's working days follow holidays changed after it was requested.
- Carryover is worked out for each vacation year: what was left of the year before carries over on its own, up to the policy's limit (calendar and working days apart). What HR enters on a person's profile counts only in the year they joined, which the form's hint names.
- The country holiday import takes only public holidays of the whole country and of the region chosen; regional holidays and observances are no longer days off for everyone. Re-importing keeps the holidays you switched off, a holiday's date change moves it to its year, and deleting a policy is all or nothing. Policy fields and carryover hold up to 60 days, and bonus days count in working days.
- Editing the dates, type or person of a pending request asks its approvers again; a comment-only edit leaves its approval as it was.
- Approval goes only to people who can decide (active, with Admin, HR or Manager). When an approver is deactivated or loses that role, their open steps close and the request moves on as a new one would, so it no longer waits forever.
- Someone who approved an earlier level approves their steps of the next level at once.
- Approvals and All requests say when a decision wasn't made (someone decided first, the request changed or went, or it will be retried), and level 2 is called "Admin approval" when only admins are on it.

### Time tracking
- The week form keeps refusing a cell whose time changed elsewhere after the form opened, also after Add a project, Show weekend or another day rebuilt it, and such a cell says what it holds now.
- Every screen counts what waits for your approval in the database, beside its own reads: an admin's Approvals screen takes 2 round trips to the database instead of 6, and Home 4 instead of 6.
- A billing report over more than 65,535 approved entries no longer fails.
- The Monday reminder of unsubmitted time goes out within 10 minutes of 09:00 UTC, a few messages a second per workspace so that Slack doesn't refuse them, and a workspace where it fails no longer keeps the others from getting theirs.
- Time reports and "Who hasn't submitted" are added up in the database, and the time report's CSV is read a page at a time: a year's report of a 400-person workspace takes a tenth of a second instead of three seconds and half a gigabyte of the app's memory, during which other people's clicks waited. Sending the CSV no longer works the report out twice. A CSV holds at most 200,000 entries; above that the DM asks for a shorter period or a narrower report.
- A billing report is worked out once, after its form closes, instead of twice, once of them before Slack's answer. "Lock in a snapshot" opens its confirmation at once and adds up what it would lock in the database after, and a snapshot is made after the answer in one statement, then shown on Billing snapshots: a year of 50,000 entries no longer makes Slack show an error although the snapshot was made. When it can't be made, Reports says that nothing was locked and why; a second Lock at the same time waits for the first and takes only what is left.
- "Send CSV to my DMs" (a time report or a billing snapshot) survives a restart or a Slack outage: the CSV is made again and sent on a retry, and when it still can't go after hours of retries, a DM says so and asks to send it again. A second click while the first CSV is on its way sends no second file. A failed upload no longer leaves its message in the DM without the file, and a large file gets longer to upload.

### Running it
- `DATABASE_POOL_SIZE` defaults to 10 (was 5), and the job queue holds 3 connections (was 2): together they must stay under your Supabase project's "Pool Size" (15 on the smaller compute sizes). A query that gets no connection within 2 seconds now fails instead of waiting.
- `JOBS_CONCURRENCY` (optional, default 4): how many background jobs run at once, so that a burst of them leaves connections to people's clicks.
- A crash or restart right after a change no longer loses the work that follows it: the job is saved in the change's transaction (asking the approvers of a new or edited request, telling people of a decision, a comment or a rejection, the approvers' message about submitted time, the time off offers, handing over a deactivated approver's requests), and a Slack event's job before Slack gets its answer. Requesting time off takes one more round trip to the database before its answer for this, and HR's edits and deletions of logged time off one more each.
- README → Self-hosting says why to run the app in the database's region.
- A restart or a deploy no longer cuts work off: on SIGTERM the app stops taking requests first, finishes the requests and the work in flight for up to 12 seconds, then closes, in 22 seconds at most. `docker-compose.yml` now sets `stop_grace_period: 30s`; with `docker run` pass `--stop-timeout 30`, and on a platform such as Render or Fly.io set its grace period to 30 seconds (README → Self-hosting). Sending a CSV takes a few round trips to the database before its answer, to save its job.
- A Slack rate limit on a burst of messages (the Monday reminder, approvers asked at once) no longer holds up people's screens and the approvers' messages: only the kind of call Slack limited waits, for as long as Slack asks, and a message sent in the background waits out up to six rate limits before it fails and waits minutes for a retry. Retries of failed jobs run a few at once, no more than there are free slots, and the next check for them waits until the last one is over, so a retry no longer expires and counts as failed while it waits behind others for a slow Slack. The app also no longer keeps a Slack client for every token it used until it restarts (a workspace gets a new token every 12 hours).
- My time's list reads only your own entries, and Time logs and the Approvals lists read only the page they show and count the rest without copying them; each render read the workspace's whole history of time before. This comes with a database migration, part of the update step.
- Two instances at once, as in a zero-downtime deploy, no longer break a workspace whose bot token rotates: Slack takes a refresh token once, so one instance refreshes it while the other waits and then uses the new pair, and a refreshed pair is never saved over a newer one. After a reinstall or an uninstall in one instance, the other drops the revoked token at its next Slack call and tries again with the stored one (a modal that failed to open opens at the next click). When a refresh fails while the old token still works, the old one is used for another minute instead of every call reading the database and calling Slack again. The daily import of members runs once across instances, and a restart no longer runs it again: every instance checks every hour and claims a workspace whose import is a day old. This comes with a database migration, part of the update step.
- A Slack event that Slack sends again, because the app's answer took over 3 seconds, no longer starts its work again: a shared file is imported, or previewed, once. This comes with a database migration, part of the update step.
- A click on a big screen is no longer refused before the app sees it: Slack sends the whole screen with a click in App Home, and a billing report of 100 lines with names in Cyrillic was just over the 100 KB the app took, so Slack showed an error. It takes up to 1 MB now, and answers a bigger request with 413 instead of a server error.
- Importing `user-vacations.csv` takes the same few statements for hundreds of lines as for one, all in one transaction: it took about ten a line, one after another, minutes for 500 lines with the database far away, and a first run over 5 minutes was started again. A line the database refuses still only skips that line. Applying a team file already moved people in a statement per team.
- A filter over a list of IDs (Approve all over every waiting entry) sends the list as one value, so a list longer than 65,535 IDs no longer fails.
- **Update step:** this release adds six database migrations (`20261112100000_company_rules.sql`, `20261112110000_team_file_uploads.sql`, `20261112120000_new_person_prompts.sql`, `20261112130000_time_entries_list_invoker.sql`, `20261112140000_member_sync_claim.sql`, `20261112150000_slack_event_receipts.sql`). Apply them as 0.2.0 describes, with `pnpm supabase db push --remote "<connection string>"`; the app refuses to start without them.
- The `/user-team-mapping` command and `user-team-mapping.csv` are gone, replaced by the team file. Apply `slack-app-manifest.yml` again to drop the command from an installed app.
- HR may now share files with the bot (the team file); `user-vacations.csv` stays Admin only.

## [0.2.0] - 2026-11-10

A weekly timesheet and time off logged as time. Update step: two database migrations, see Running it.

### Time tracking
- My time shows a week: a table of every project with your time on each day, a status line, previous and next week, and "Submit week" for the week's drafts and rejected entries. A line counts the drafts and rejected entries of earlier weeks, with a button to the oldest of them; the rejection message names the week, and so does the Monday reminder for rejected entries.
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

[0.3.0]: https://github.com/dvovna/logbook/releases/tag/v0.3.0
[0.2.0]: https://github.com/dvovna/logbook/releases/tag/v0.2.0
[0.1.0]: https://github.com/dvovna/logbook/releases/tag/v0.1.0
