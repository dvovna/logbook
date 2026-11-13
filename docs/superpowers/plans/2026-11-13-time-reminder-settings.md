# Settings for the time reminder: implementation plan

**Goal:** a person chooses how often Logbook reminds them of time they haven't submitted, or never.

**Spec:** `docs/superpowers/specs/2026-11-13-time-reminder-settings-design.md`

## Global Constraints

- `CLAUDE.md` is binding (naming, accessibility, imports, comments only for the non-obvious, workspace scoping, transactions).
- The default is `weekly`: existing people and the existing tests of the weekly reminder behave as before.
- The weekly claim is unchanged; a job payload of the old shape (`monday`) still works.
- Labels of the four choices live in `labels.ts`. Bot copy is English.
- A new column gets its migration, `pnpm db:init`, `pnpm db:types`. Home's `roundTrips` budget doesn't grow.
- Commits are short imperative one-liners with no trailers. Docs change with the behavior.

## Review Focus

1. A person who sets `off` after their reminder was saved gets nothing. Test: Task 2.
2. Monday for a `daily` person: one message, not two. Test: Task 2.
3. The weekend and before 09:00 UTC: no daily reminder. Test: Task 1.
4. A form saved with only the time select (no reimbursements) changes no opt-out. Test: Task 3.
5. A deploy day: a job saved by the old code is still sent. Test: Task 2.

## Task 1: the setting and the schedule

- Migration `time_reminder_settings`: `users.time_reminder text not null default 'weekly'` with a check of the four values; `slack_teams.time_reminder_day date`.
- `enum TimeReminder { Off, Daily, Weekly, Monthly }` in `src/users/enums/time-reminder.enum.ts`; `UsersService.setTimeReminder(user, value)`.
- `src/time-entries/utils/time-reminder-schedule.ts`: `dailyReminderDay(now: Date): string | null` (today's date, Monday to Friday from 09:00 UTC) and `weeklyReminderGroups(monday: string): TimeReminder[]` (`[weekly]`, plus `monthly` when the Monday's day is 1 to 7). Unit spec with: Monday 2026-06-15 09:00 → the day; 08:59 → null; Saturday and Sunday → null; `2026-06-01` → weekly and monthly; `2026-06-08` → weekly only; `2026-06-07` (a Sunday is never passed, but day 7 counts) → both.

## Task 2: reminding by the setting

- `TimeEntriesRepository.findUserIdsWithOpenUpTo(slackTeamId, dateTo, reminders)` joins the people's setting; `SlackTeamsService.claimReminderDay(id, day)`.
- `TimeEntryRemindersService`: the week's claim reminds `weeklyReminderGroups(monday)`; a second pass claims the day and reminds `daily` people of entries before it; the job's payload gains `dateTo`, falls back to the Monday's last week end, and skips `off`; the message ends with "Change how often: Home → 🔔 Reminders."
- Integration tests in `test/integration/time-entries.int-spec.ts`: daily on a Wednesday for yesterday's draft, once; nothing for weekly and off that day; monthly only in the first week; a daily person on Monday gets one message; set to off between the claim and the send; an old-shape job.

## Task 3: the form and Home

- `RemindersModalView` gains the select (initial: the person's setting) and loses the "will be set here too" line; the checkboxes only with reimbursements. The parser and handler save the setting; `RemindersModalService.open` opens with no reimbursements too.
- Home: the button in the time tracking row when the person tracks time, else in the Receipts section.
- Integration tests: the form shows the current setting, saves another, Home says "✅ Reminders saved."; no reimbursements → the form with the select alone, and saving changes no opt-out; the button's place for someone with time and someone with receipts only.

## Task 4: docs and the whole suite

- `docs-site`: everyone/submit-time.md (the reminder and how to change it), everyone/receipts.md (the form), reference notifications; `CLAUDE.md` (the reminder paragraph).
- `pnpm lint`, `npx tsc --noEmit`, `pnpm test`, `pnpm test:int`, `pnpm build`, the docs build.
