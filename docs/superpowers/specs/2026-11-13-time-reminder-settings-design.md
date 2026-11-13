# Settings for the time reminder

## Why

Logbook reminds everyone the same way: once a week, on Monday from 09:00 UTC, people with drafts or rejected entries from before that week. Someone who logs every day wants it sooner, someone who logs once a month wants it rarely, and someone who doesn't want it can't turn it off. The receipts feature added a personal "🔔 Reminders" form with a line promising this setting.

## What a person gets

In Home → 🔔 Reminders, a select "Remind me about time I haven't submitted":

- Every working day
- Every Monday (the default: nothing changes for anyone who doesn't touch it)
- First Monday of the month
- Never

The reminder is still only about drafts and rejected entries. Its message ends with where to change how often it comes.

## Non-goals

A reminder that nothing was logged; holidays and time off; a time of day or a time zone; a frequency an admin sets for everyone.

## Approaches

One way fits: a setting on the person, read when the reminders are saved. A table of reminder preferences per kind was considered and dropped: there is one kind, and receipts keep their own opt-outs per reimbursement.

## Design

- `users.time_reminder`: `off`, `daily`, `weekly` (default) or `monthly`.
- The weekly claim (`slack_teams.time_reminder_week`) stays as it is, so a deploy with the old process beside the new one reminds once. On the week it claims, people set to `weekly` are reminded, and people set to `monthly` when that week's Monday is the first of its month (day 1 to 7). As now, a week whose Monday the app missed is claimed on the first tick after.
- A second claim, `slack_teams.time_reminder_day`, for `daily`: Monday to Friday (UTC) from 09:00 UTC, once a day, people set to `daily` with open entries dated before that day. A missed day is not caught up the next day beyond that day's own reminder.
- The job carries the last date it reminds of; a job saved by the old code carries its Monday. It sends nothing to someone who set `off` since.
- Home shows 🔔 Reminders in the time tracking row for people who track time, and in the Receipts section for those who only send receipts. The form opens for everyone and shows the receipts checkboxes only when the workspace has reimbursements.
