# Logging time: a weekly timesheet and time off as time

Issues: dvovna/logbook#59 (weekly timesheet) and dvovna/logbook#51 (offer to log approved time off as time entries).

## Why

Time is logged one entry at a time (Home → Log Time or `/log`: one project, one day, one amount). Most people fill in their week at once, usually on Friday; some log every day. They work on one or two projects a week, three to five at most, rarely more. Logging a week today means a dozen forms. Some companies also log time off as hours on a project such as "Vacations Paid", which today means logging every vacation day by hand.

Success: someone fills in a week in one form, or a day in one form, and sends the week for approval with one click; and an approved vacation becomes the right time entries with one click.

## Goals

1. **The week on My time.** A read-only table: the viewer's projects down the side, Monday to Friday across (Saturday and Sunday when they hold time), each day's total and the week's total, and the week's status (how many entries are drafts, submitted, approved, rejected). Previous and next week. Under it: **Fill in the week**, **Fill in today**, **Submit week**.
2. **The week form** (Fill in the week): every project of the viewer × every day of the week, hours per cell, in one modal; saves all cells at once.
3. **The day form** (Fill in today): one day × every project of the viewer, hours per project and one optional comment; the day can be changed in the form.
4. **Both forms write the same entries** as Log Time does; what one form saves, the other form, the table and the lists show.
5. **Submit week** sends that week's drafts and rejected entries for approval, as Home's "Submit for Approval" does for all of them. Approvers are told as they are now (`time_entries.submitted`).
6. **Time off as time (#51).** Admins set a project per leave type and the hours of a working day; when a vacation is approved, the requester's "approved" message offers a button that logs one approved entry per working day of the vacation on that project.

## Non-goals

- Tasks and task rates (#56): a separate round.
- Reminding approvers of what still waits for them (rest of #7): a separate round.
- Logging time off automatically on approval without the person's click.
- An editable grid: Slack has none. The table is read-only; editing is in the forms.
- Per-person time zones. The app works in UTC, as reports do.

## Anti-goals (would be a failure even if it works)

- A form that can change entries the owner may not change today: submitted, approved, billed (in a billing snapshot) or someone else's.
- Losing or silently merging what someone typed: a cell that stands for several entries must not overwrite them with one number.
- Duplicated time: pressing "Log … to Vacations Paid" twice, or a vacation changed after logging, must not leave two sets of entries.
- A week form too long to use for the common case (one or two projects): it should be 5–10 fields, not a wall.

## Constraints

- **Slack Block Kit:** a modal holds at most 100 blocks; inputs stack vertically; `table` is read-only, App Home and messages only, one per view (the test fake refuses a second one and a table in a modal); an actions block shows 5 elements before "+ N more" (`splitIntoRows`). Interaction answers within 3 seconds (`runInBackground` for anything slower).
- **Entries:** minutes in 15-minute steps, at most 24 hours per user, project and day (validation and check constraint); the owner changes only drafts and rejected entries (a changed rejected entry becomes a draft); entries in a billing snapshot are locked for everyone (`TimeEntriesValidationService`, trigger `time_entries_keep_billed`).
- **Which projects:** a member logs only on `get_user_projects` projects (their team's and their own). Admin and HR log for anyone on any active project, but these forms are for one's own time.
- **Conventions** in `CLAUDE.md`: domain code doesn't import `src/slack`; text people typed goes through `escapeMrkdwn`; every handler declares `allowedRoles`; IDs from the client are checked to be the workspace's and the user's; schema changes are migrations with `pnpm db:types`; integration tests for every flow, including what a role may not do.

## Decisions

### The week table (My time)

- **Weeks start on Monday** (as `presetPeriod` does). The table shows Monday–Friday, plus Saturday or Sunday when that day holds time.
- **Rows:** the projects with the viewer's time that week (an archived project or one they left still shows its hours).
- **Cells:** the sum of the viewer's non-deleted entries for that project and day, any status.
- **Status line** for the week: counts by status, and hours.
- **Navigation:** previous / next week buttons; the week shown is in the tab's metadata. "This week" is the default.
- The existing list of entries (grouped by day) stays under the table, for the shown week. *(Builder-check call:)* on My time the week navigation replaces the From/To filters; the project filter stays. "Submit week" replaces My time's "Submit N entries"; Home's "Submit for Approval (N)" still sends all open entries.
- Time logs (everyone's entries, Admin and HR) does not get the table.

### Which projects the forms offer (decided with the user: as Harvest does)

- **Rows of the week and day forms:** the projects the viewer logged time on in the shown week or in the 4 weeks before it *(4 is my call: it covers coming back from a vacation)*, not every project they're assigned to. A team with several assigned projects shouldn't give someone 20 inputs for the one project they work on.
- **Add a project:** both forms have a select that adds a row: the projects the viewer may log on (`get_user_projects` for everyone but Admin and HR, every active project for Admin and HR, as the Log Time form does). Someone with no recent time starts from an empty form and adds what they need.
- **At most 10 rows** in a form, which keeps the week form under Slack's 100 blocks with the weekend shown; the add select disappears at 10.

### The week form

- One section per row project, one input per day (Monday–Friday; Saturday and Sunday when "Show weekend" is checked or when they hold time), hours with the same parsing as Log Time (decimal point or comma, 15-minute steps).
- **What a cell can change:** a cell is editable when it holds no entry, or exactly one entry of the viewer that is a draft or rejected and not billed. Then:
  - a number creates a draft, or updates that entry (a rejected entry becomes a draft, as today);
  - an empty cell deletes that draft or rejected entry;
  - unchanged cells are left alone.
- **Cells that can't change** (several entries, or one that is submitted, approved or billed) show the hours as text, not as an input, with the reason (e.g. "3 entries" / "submitted").
- **Saving** checks every cell first and saves nothing when one is invalid: the error is shown at that cell's input (`response_action: errors`), as other forms do.
- An optional **Submit the week** checkbox submits the week's drafts and rejected entries after saving.
- Comments: none in the week form.

### The day form

- A date picker (today by default), one hours input per row project (same rules as the week form's cells, with the same read-only cells), and one optional comment.
- The comment goes on every entry the form creates or changes that day; an existing entry's description is replaced only when the comment field is filled.
- Changing the date in the form re-opens it for that date (its inputs show that day's hours).

### Submit week

- Submits the viewer's drafts and rejected entries dated in the shown week (`TimeEntriesService.submit` narrowed to a period), then re-renders. Approvers get the existing DM.

### Time off as time (#51)

- **Settings**, on the Projects screen for admins (next to the currency): a project for each leave type (annual leave, bonus day, sick leave, unpaid; "Other" has none), any project of the workspace, and the hours of a working day (default 8, 15-minute steps, at most 24).
- **Storage:** a workspace's settings in a new place the builder chooses (a `workspace_settings` row, or columns on `slack_teams` as `currency` is), plus a mapping of leave type → project. A project used there can't be deleted while it is used, or the mapping is cleared; the builder picks one and says which.
- **The offer:** the "your time off is approved" DM (`VacationDecisionNotificationsService`) gets a button "Log {hours}h to {project}" when the request's type has a project. Only the requester may press it. *(Builder-check call:)* a request that becomes approved outside the workflow (HR or an admin creates it approved, or changes its status to approved) gets the same offer in a DM of its own; the CSV import offers nothing (it is history).
- **Pressing it:** creates, in one transaction, one entry per working day of the request (weekends and the policy's enabled holidays left out, as `VacationDaysCalculationService` counts them): the requester's, their current team, the mapped project, the configured hours, status approved, linked to the request (`time_entries.vacation_request_id`, `ON DELETE SET NULL`). Days on which the requester already has time on the mapped project (of this request or not: logged by hand, or unlinked by a CSV import) are skipped, so pressing again adds nothing and nothing is logged twice; the message says which days were skipped. *(Builder-check call.)* The 24-hours-per-project-and-day rule still applies: a day that would exceed it is skipped and the message says so.
- **Afterwards:** the message is updated to say what was logged.
- **When the vacation changes after approval** (HR or an admin changes its dates or status, or deletes it; a requester can't cancel an approved request today, and this round doesn't change that): its linked entries that aren't billed are deleted, in the same transaction as the change. Billed ones stay; the person who changed the vacation is told which days stay billed. If the request is still approved afterwards, the requester gets the offer again.
- **CSV import** (`user-vacations.csv`) replaces a person's vacations: the entries keep their hours and lose the link (`ON DELETE SET NULL`).
- **In the forms and table**, these entries are approved, so they show as read-only cells.

## Left to the builder

- Module and file layout, names, how the forms' metadata carries the week and the rows.
- Where the week/day form logic sits (a domain service that takes "cells" and does the creates, updates and deletes in one transaction is expected).
- The exact Block Kit of the forms and the table, within the constraints above.
- The storage of the #51 settings (see above) and the migration(s).
- Whether the day form's date change re-opens via `views.update` or a fresh modal.
- Test layout, as long as every goal, anti-goal and role rule has an integration test.
