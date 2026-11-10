# Weekly Timesheet and Time Off as Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People fill in a week or a day of time in one Slack form and send the week with one click (#59); an approved vacation becomes approved time entries with one click (#51).

**Architecture:** A domain `TimesheetService` (in `src/time-entries`) reads a week as rows × days and saves a set of cells in one transaction; Slack views in `src/slack/tabs/time-tracking` show the week as a table on My time and as two modals (week, day). A new domain module `src/time-off-logging` holds the time-off settings and logs a vacation as entries; `VacationRequestsService` removes a vacation's entries in the transaction that changes it; the Slack side offers the button in DMs.

**Tech Stack:** NestJS 11, TypeScript 6, Kysely 0.28 on Postgres (Supabase), Slack Block Kit, Jest (unit `*.spec.ts`, integration `test/integration/*.int-spec.ts`), pnpm 10.

**Spec:** `docs/superpowers/specs/2026-11-10-time-logging-design.md`

## Global Constraints

- Weeks start on Monday (`presetPeriod`); dates are UTC `YYYY-MM-DD` strings, as `work_date` is.
- Hours: decimal point or comma, 15-minute steps, more than 0 and at most 24; the same parsing and messages as Log Time (`user-time-entry-modal-view-values.parser.ts`: "Hours must be a number between 0 and 24", "Use 15-minute steps: 0.25, 0.5, 0.75, 1…"). In the timesheet forms an empty cell, or `0`, means no time.
- At most 24 hours per user, project and day ("Total logged time for this project and date cannot exceed 24 hours").
- The owner changes only drafts and rejected entries; a changed rejected entry becomes a draft; billed entries (in a billing snapshot) change for nobody.
- Form rows: projects with the viewer's time in the shown week or the 4 weeks before it, plus added ones; at most 10 rows (`MAX_TIMESHEET_ROWS = 10`). Projects one may add: `get_user_projects` for everyone but Admin and HR; every active project for Admin and HR (as `TimeEntryModalService.getProjects`).
- Time off: the hours of a working day default to 8 (stored as 480 minutes, 15-minute steps, at most 1440); leave types with a project: annual leave, bonus day, sick leave, unpaid ("Other" has none).
- Conventions (`CLAUDE.md`): no `src/slack` import from domain code; `escapeMrkdwn` for typed text; every handler declares `allowedRoles`; IDs from the client are checked to be the workspace's and the user's; a migration per schema change with `pnpm db:types`, functions revoked from `public, anon, authenticated`; integration tests use `support/tab-readers.ts` and compare whole values.
- Commits: one short imperative English line, no attribution trailer (repo rule). Push verified work to `development`.

## Review Focus

1. A week across a month or year boundary (Mon 28 Dec 2026 – Sun 3 Jan 2027): the table's day headers and the saved `work_date`s are those dates. Test in Task 2.
2. Stale form: a cell's draft was submitted (from Home) after the week form opened; saving must not change it, and the error names that cell. Test in Task 3.
3. Odd hours input in a cell — `"1,5"`, `"0"`, `""`, `"-1"`, `"abc"`, `"25"`, `"0.1"` — saves 90 minutes, removes, removes, and three errors at that cell with the Global Constraints messages. Test in Task 3.
4. A recent row on a project that is now archived or no longer the viewer's: shown with its hours, read-only, never a new entry. Test in Task 3.
5. A vacation that covers a weekend and a policy holiday: entries only on working days, as many as the request's `working_days`. Test in Task 6.

---

### Task 1: Read a week (domain)

**Files:**
- Create: `src/time-entries/services/timesheet.service.ts`, `src/time-entries/types/timesheet.types.ts`
- Modify: `src/time-entries/time-entries.module.ts` (provide, export `TimesheetService`)
- Test: `src/time-entries/services/timesheet.service.spec.ts`

**Interfaces:**
- Produces:
  - `TimesheetCellLock = 'several' | 'submitted' | 'approved' | 'billed' | 'project'` ('project': archived or not the viewer's to log on)
  - `ITimesheetCell { date: string; minutes: number; entryId: string | null; lock: TimesheetCellLock | null }`
  - `ITimesheetRow { projectId: string; projectName: string; clientName: string | null; cells: ITimesheetCell[] }` (one cell per day of `days`)
  - `ITimesheetWeek { weekStart: string; days: string[] /* Mon..Sun */; rows: ITimesheetRow[]; dayTotals: number[]; total: number; statusCounts: Record<TimeEntryStatus, number> }`
  - `TimesheetService.getWeek(user: IUserViewModel, weekStart: string): Promise<ITimesheetWeek>` — rows: projects with the user's time that week
  - `TimesheetService.getFormRows(user: IUserViewModel, weekStart: string, addedProjectIds: string[]): Promise<ITimesheetWeek>` — rows: recent (that week and 4 weeks before) ∪ added (only projects the user may log on), sorted by client then project name as `get_user_projects`, cut to `MAX_TIMESHEET_ROWS`
  - `TimesheetService.allowedProjects(user: IUserViewModel): Promise<IUserProject[]>` — the add list
  - `weekStartOf(date: string): string` and `weekDays(weekStart: string): string[]` in `src/common/utils/period-presets.ts`

- [ ] **Step 1: Write the failing tests** in `timesheet.service.spec.ts` with mocked repositories, as other specs do:
  - `sums a project's entries of a day into one cell` — two drafts of 60 and 30 on Wed → `{ minutes: 90, entryId: null, lock: 'several' }`
  - `locks a cell by its one entry's status or billing` — submitted → `'submitted'`, approved → `'approved'`, a draft in `findBilledIds` → `'billed'`, a draft → `lock: null, entryId: <id>`
  - `shows a week's archived project with its hours` — `getWeek` has the row; its cells are locked `'project'`
  - `offers recent projects and added ones, at most 10` — 12 candidate projects → 10 rows; an added project the user may not log on is left out; a project last logged 5 weeks before the shown week is not a row
  - `lets Admin and HR add any active project` — `allowedProjects(admin)` lists a project assigned to nobody; a member's is `get_user_projects`
  - `weekStartOf('2027-01-01') === '2026-12-28'`, `weekDays('2026-12-28')` ends with `'2027-01-03'`
- [ ] **Step 2: Run** `pnpm test src/time-entries/services/timesheet.service.spec.ts` — Expected: FAIL (module not found)
- [ ] **Step 3: Implement** the types, `weekStartOf`/`weekDays` (UTC, via `presetPeriod`'s Monday rule), and `TimesheetService` (entries through `TimeEntriesService.findMany({ userId, slackTeamId, dateFrom, dateTo })`, billing through `findBilledIds`, projects through `GetUserProjectsQuery` / `ProjectsService` as `TimeEntryModalService.getProjects` does — move that method into `TimesheetService.allowedProjects` and have the modal service call it).
- [ ] **Step 4: Run** the spec and `pnpm test` — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Read a person's week of time as rows of projects and days"`

### Task 2: The week on My time, with Submit week

**Files:**
- Modify: `src/slack/tabs/time-tracking/views/time-entries-tab.view.ts` (metadata `weekStart?: string`; the table and the buttons on My time only), `src/slack/tabs/time-tracking/services/time-entries-tab.service.ts`, `src/slack/tabs/time-tracking/handlers/time-entries-tab-action.handler.ts`, `src/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums.ts`, `src/time-entries/services/time-entries.service.ts` (`submit` takes `dateFrom?`/`dateTo?`)
- Create: `src/slack/tabs/time-tracking/views/timesheet-table.view.ts`
- Test: `test/integration/timesheet.int-spec.ts`

**Interfaces:**
- Consumes: `TimesheetService.getWeek`, `weekStartOf`, `weekDays`
- Produces: action ids `TimeEntriesTabViewActionId.PreviousWeek = 'timesheet_previous_week'`, `NextWeek = 'timesheet_next_week'`, `FillWeek = 'timesheet_fill_week'`, `FillDay = 'timesheet_fill_day'`, `SubmitWeek = 'timesheet_submit_week'`; `TimesheetTableView.getBlocks(week: ITimesheetWeek): AnyBlock[]`; `TimeEntriesService.submit({ id?, slackTeamId, dateFrom?, dateTo? }, user)`

- [ ] **Step 1: Write the failing tests** in `timesheet.int-spec.ts` (`describe('The week on My time')`, today Wed 2026-06-17):
  - `shows the week's projects by day with totals and status` — `tableRows(myTime)` (a reader added to `tab-readers.ts`) equals `[['Project','Mon 15','Tue 16','Wed 17','Thu 18','Fri 19','Total'], ['Website · Acme','2h','','1h 30m','','','3h 30m'], ['Total','2h','','1h 30m','','','3h 30m']]`; the status context line (reader `timesheetStatusOf(view)`) equals `'🕒 Week of 15 Jun · 3h 30m · 📝 1 draft · 📤 1 submitted'` (statuses with no entries left out, labels from `TIME_ENTRY_STATUS_LABELS`)
  - `lists the shown week's entries under the table` — after `PreviousWeek`, `listItems(myTime)` holds only the entries dated 8–14 Jun
  - `adds Saturday and Sunday when they hold time` — an entry on Sun 21 → header ends `'Sat 20','Sun 21','Total'`
  - `goes to the previous and next week` — after `PreviousWeek` the header starts `'Mon 8'`
  - `shows a week across the new year` (Review Focus 1) — `travelTo('2027-01-01')` → header `'Mon 28','Tue 29','Wed 30','Thu 31','Fri 1'`
  - `submits only the shown week's drafts and rejected entries` — a draft of last week stays draft; this week's draft and rejected become submitted; the manager gets the submitted DM
  - `keeps the project filter and leaves the dates out` — `actionIdsOf(myTime)` has the project filter, not the From/To pickers; the filter narrows the list, the table still shows the whole week *(my call: the table is the week's whole time)*; Time logs still has its From/To and no table
- [ ] **Step 2: Run** `pnpm test:int test/integration/timesheet.int-spec.ts` — Expected: FAIL
- [ ] **Step 3: Implement**: the table (`table` block; hours with `getDisplayTime`, empty for 0; project title `projectName · clientName`), the status context, a row of buttons `[⬅️ Previous week] [Next week ➡️] [✏️ Fill in the week] [✏️ Fill in today] [📤 Submit week (N)]` (N = the week's drafts + rejected; split by `splitIntoRows`), the list under it for the shown week (dates from `weekStart`), the handler's actions (`FillWeek`/`FillDay` open the modals of Tasks 3–4; until then they may open nothing).
- [ ] **Step 4: Run** the int spec, `pnpm test:int test/integration/time-entries.int-spec.ts`, `pnpm test` — Expected: PASS (update time-entries tests that used My time's date filters or "Submit N entries")
- [ ] **Step 5: Commit** `git commit -m "Show the week on My time and submit it"`

### Task 3: Fill in the week (save cells)

**Files:**
- Modify: `src/time-entries/services/timesheet.service.ts`, `src/slack/enums/integration-callback-id.enum.ts` (`TimesheetForm = 'timesheet_form'`)
- Create: `src/slack/tabs/time-tracking/views/timesheet-form-modal.view.ts`, `src/slack/tabs/time-tracking/parsers/timesheet-form.parser.ts`, `src/slack/tabs/time-tracking/handlers/timesheet-form-submit.handler.ts`, `src/slack/tabs/time-tracking/handlers/timesheet-form-action.handler.ts`, `src/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum.ts`
- Test: `test/integration/timesheet.int-spec.ts` (`describe('Fill in the week')`), `src/time-entries/services/timesheet.service.spec.ts`

**Interfaces:**
- Consumes: `getFormRows`, `allowedProjects`, `TimeEntriesService.create/update/delete` rules
- Produces:
  - `ITimesheetCellInput { projectId: string; date: string; minutes: number | null; shownMinutes: number | null }` — `shownMinutes` is what the form showed (the input's `initial_value`, read from the submitted `payload.view.blocks`; no room for it in `private_metadata`, 3000 characters)
  - `TimesheetService.saveCells(user, inputs: ITimesheetCellInput[], options: { comment?: string; submitWeekStart?: string }): Promise<{ created: number; updated: number; deleted: number; minutes: number }>` — an input with `minutes === shownMinutes` is untouched and skipped, whatever the cell holds now (a stale form never overwrites); every touched input is checked against the cell as it is now (editable, project allowed, ≤ 24h) and the first bad one throws `ValidationError(message, cellKey(projectId, date))`; then one `TransactionService.transaction` writes them all; `minutes` is the week's total after saving, for the notice
  - `cellKey(projectId, date) = \`${projectId}_${date}\`` (the input's `block_id` and `action_id`)
  - `TimesheetFormMetadata { mode: 'week' | 'day'; weekStart: string; date?: string; addedProjectIds: string[]; showWeekend: boolean; pageMetadata?: string }`
  - `TimesheetFormActionId.AddProject = 'timesheet_add_project'` (static select, `dispatch_action`), `ShowWeekend = 'timesheet_show_weekend'` (checkbox, `dispatch_action`), `SubmitWeek = 'timesheet_submit_week_too'` (checkbox input)

- [ ] **Step 1: Write the failing tests:**
  - `fills a week at once` — the form for two recent rows has exactly 10 hour inputs; typed `6,4,5,'',''` and `2,4,3,2,''` → 7 drafts with those minutes; the form closes; My time shows the table and `noticeOf` `'✅ 26h saved for the week of 15 Jun.'`
  - `changes and removes a draft and a rejected entry by its cell` — `'1.5'` updates (rejected → draft, reason cleared); `''` and `'0'` delete
  - `shows locked cells as text with the reason` — submitted, approved, billed and two-entry cells are context text (`'Wed 17 · 2h · submitted'`, `'· approved'`, `'· billed'`, `'· 2 entries'`), not inputs
  - `refuses a forged input for a locked cell` — a `cellKey` value for a submitted entry added to the submitted state → the modal's error message (the view has no input block of that key, so `response_action: errors` can't name it), entry unchanged
  - `answers odd hours at their cell` (Review Focus 3) — `response_action: errors` keyed `cellKey(...)` with the Global Constraints messages for `'-1'`, `'abc'`, `'25'`, `'0.1'`; `'1,5'` alone saves 90 minutes; nothing saved while any cell is bad
  - `refuses a cell that changed after the form opened` (Review Focus 2) — submit the draft from Home, then submit the form with that cell changed → error at the cell, entry unchanged; the same cell left as shown → saved without error, entry unchanged
  - `adds a project and shows the weekend` — choosing a project in `AddProject` updates the view with its row; checking `ShowWeekend` adds Sat/Sun inputs; Saturday shows without the checkbox when it holds time; at 10 rows the select is gone; a project the member may not log on, sent as the select's value, adds nothing
  - `keeps old and archived projects read-only` (Review Focus 4) — a recent row on an archived project shows hours as text; a forged input for it is refused
  - `submits the week too when asked` — the checkbox submits the week's drafts after saving
  - `is only for one's own time` — an HR user's form shows and saves only HR's own entries
  - unit: `saveCells throws at the first bad cell and writes nothing`; `saveCells skips untouched cells`
- [ ] **Step 2: Run** `pnpm test:int test/integration/timesheet.int-spec.ts -t 'Fill in the week'` — Expected: FAIL
- [ ] **Step 3: Implement** the modal (`mode: 'week'`): per row a section header and one `input` per shown day (`plain_text_input`, `block_id`/`action_id` = `cellKey`, optional, initial value = hours); locked cells as a context line; `AddProject` select of `allowedProjects` minus the rows; `ShowWeekend` checkbox; `SubmitWeek` checkbox. The fields vary per form, so `BaseValuesParser`'s fixed config doesn't fit: the submit handler overrides `getFormData` and reads every state value whose key parses as `cellKey` (the Log Time hours zod schema, moved to a shared export, per value), and `BaseModalFormSubmitHandler` gets a `protected blockIdOfField(field: string, payload): string | null` hook (default: the parser lookup, as now) that the timesheet handler answers with the field itself when the submitted view has an input block of that id, else `null` (then the modal error). The submit handler (`allowedRoles: ALL_ROLES`) calls `saveCells` and closes with `success()` and the notice; the action handler (`type: 'block_actions'`, `callbackId: ViewCallbackId.TimesheetForm`) answers with `views.update` of the modal. Register the handlers in `time-tracking.module.ts`.
- [ ] **Step 4: Run** the int spec, `pnpm test`, `pnpm lint` — Expected: PASS, and the fake's Block Kit rules pass for a 10-row week with the weekend (≤ 100 blocks)
- [ ] **Step 5: Commit** `git commit -m "Fill in a week of time in one form"`

### Task 4: Fill in today

**Files:**
- Modify: `timesheet-form-modal.view.ts`, `timesheet-form.parser.ts`, `timesheet-form-action.handler.ts`, `timesheet-form-action-id.enum.ts` (`Day = 'timesheet_day'` datepicker with `dispatch_action`), `timesheet-form-submit.handler.ts`
- Test: `test/integration/timesheet.int-spec.ts` (`describe('Fill in today')`)

**Interfaces:**
- Consumes: Task 3's modal, parser and `saveCells(..., { comment })`

- [ ] **Step 1: Write the failing tests:**
  - `fills a day at once` — two inputs (one per row project), typed `5` and `3` with comment `'Sprint review'` → two drafts dated today with that description
  - `changes the day in the form` — choosing Thu 18 in `Day` updates the view: inputs show Thursday's hours
  - `shows what the week form saved` — after Task 3's week form saved Wed 5h on Website, the day form for Wed shows `5` in Website's input, and `AddProject` works here as in the week form
  - `keeps an entry's description when the comment is left empty` — an existing draft with description `'Design'` changed to 2h keeps `'Design'`
  - `escapes the comment where it shows` — `'<!channel>'` is stored as typed and appears escaped on My time
- [ ] **Step 2: Run** `pnpm test:int test/integration/timesheet.int-spec.ts -t 'Fill in today'` — Expected: FAIL
- [ ] **Step 3: Implement** `mode: 'day'`: a datepicker (`Day`, initial today), one input per row for that date, an optional comment input (`comment`, max 500 as the Log Time comment); `saveCells` writes the comment as `description` on created entries and on changed ones only when given.
- [ ] **Step 4: Run** the int spec and `pnpm test` — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Fill in a day of time in one form"`

### Task 5: Time off settings

**Files:**
- Create: `supabase/migrations/20261111100000_time_off_logging.sql`, `src/time-off-logging/time-off-logging.module.ts`, `src/time-off-logging/services/time-off-settings.service.ts`, `src/time-off-logging/repositories/time-off-projects.repository.ts`, `src/slack/tabs/projects/views/time-off-settings-modal.view.ts`, `src/slack/tabs/projects/handlers/time-off-settings-form-submit.handler.ts`
- Modify: `src/common/types/database.types.ts` (`pnpm db:types`), `src/slack-teams/*` (`time_off_minutes_per_day` read/write), `src/slack/tabs/projects/views/projects-tab.view.ts` (admin button `🌴 Time off projects` next to the currency), `src/slack/common/services/slack-action-permissions.service.ts` (`[UserRole.Admin]`), `src/slack/enums/integration-callback-id.enum.ts` (`TimeOffSettingsForm`)
- Test: `test/integration/time-off-logging.int-spec.ts` (`describe('Settings')`), `src/time-off-logging/services/time-off-settings.service.spec.ts`

**Interfaces:**
- Produces:
  - migration: `time_entries.vacation_request_id uuid null references vacation_requests(id) on delete set null` with an index; table `time_off_projects (slack_team_id uuid references slack_teams on delete cascade, vacation_type text check (in annual_leave, bonus_day, sick_leave, unpaid_leave), project_id uuid not null references projects(id) on delete cascade, primary key (slack_team_id, vacation_type))`, RLS enabled; `slack_teams.time_off_minutes_per_day integer not null default 480 check (> 0, <= 1440, % 15 = 0)`
  - `ITimeOffSettings { minutesPerDay: number; projectIds: Partial<Record<VacationType, string>> }`
  - `TimeOffSettingsService.get(slackTeamId): Promise<ITimeOffSettings>`; `set(user, settings): Promise<void>` (Admin only, `ForbiddenException` otherwise; every project id is the workspace's, else `ValidationError(…, 'projects')`)

- [ ] **Step 1: Write the failing tests:**
  - `lets an admin pick a project per leave type and the hours of a day` — the modal (no "Other" field), saved: `get()` equals `{ minutesPerDay: 450, projectIds: { annual_leave: vacations.id, sick_leave: sick.id } }`; Projects shows `noticeOf` `'✅ Time off projects saved.'`
  - `starts at 8 hours a day and no projects` — `get()` of a new workspace
  - `refuses HR, managers and members, whatever they send` — no button for them; the forged submit answers Forbidden; nothing stored
  - `refuses another workspace's project` — submitted with a foreign project id → field error, nothing stored
  - `answers 0 and 24.5 hours at their field`
- [ ] **Step 2: Run** `pnpm test:int test/integration/time-off-logging.int-spec.ts -t Settings` — Expected: FAIL
- [ ] **Step 3: Implement** the migration (apply with `pnpm db:init`, then `pnpm db:types`), the module, service, repository (`BaseRepository<'time_off_projects', …>`; replace all rows of the workspace in one transaction), the modal (one static select per leave type, optional, of the workspace's active projects, any of them, not only the admin's; a mapping to a project archived since shows empty, and saving clears it; hours input with the Log Time hours rules), the handler (`allowedRoles: [UserRole.Admin]`).
- [ ] **Step 4: Run** the int spec, `pnpm test`, `pnpm lint`, and check `git diff src/common/types/database.types.ts` is only the new columns and table — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Let admins pick a project per leave type to log time off on"`

### Task 6: Log a vacation as time (domain)

**Files:**
- Modify: `src/vacation-requests/services/vacation-days-calculation.service.ts` (`workingDates`; `calculate` returns `workingDates(...).length`), `src/time-entries/services/time-entries.service.ts` (`ICreateParams.vacationRequestId?`; `mapToViewModel` gains `vacation_request_id`)
- Create: `src/time-off-logging/services/time-off-logging.service.ts`
- Test: `src/time-off-logging/services/time-off-logging.service.spec.ts`, `test/integration/time-off-logging.int-spec.ts` (`describe('Logging')`)

**Interfaces:**
- Consumes: `TimeOffSettingsService.get`, `VacationRequestsService.findOneWithValidation`, `TimeEntriesService.findMany`
- Produces:
  - `VacationDaysCalculationService.workingDates(start: Date, end: Date, vacationPolicyId: string | null, slackTeamId: string): Promise<string[]>`
  - `ITimeOffOffer { requestId: string; projectId: string; projectName: string; minutes: number /* per day */; dates: string[] /* working days */ }`
  - `TimeOffLoggingService.offerFor(request: IVacationRequestViewModel): Promise<ITimeOffOffer | null>` — null unless approved and the type has an active (not archived) project
  - `TimeOffLoggingService.log(user: IUserViewModel, requestId: string): Promise<{ offer: ITimeOffOffer; logged: string[]; skipped: string[] }>` — only the requester (`ForbiddenException`), only approved (`ValidationError('This time off is no longer approved.')`); skips dates with any of the user's non-deleted time on the project; one transaction under `transactions.lock('time-off:' + requestId)`, so two clicks at once log one set; entries: status approved, the requester's current team, `created_by` the requester, `vacation_request_id`

- [ ] **Step 1: Write the failing tests:**
  - `logs one approved entry per working day` (Review Focus 5) — a Fri–Tue vacation with Mon a policy holiday → entries on Fri and Tue only, 480 minutes each, approved, linked; `logged.length === request.working_days`
  - `skips days that already have time on the project` — a hand-logged 8h on Fri (no link) → `skipped: ['2026-06-19']`, no second entry
  - `logs nothing twice` — calling `log` again → `logged: []`, all skipped
  - `logs one set for two clicks at once` — `Promise.all([log(), log()])` → 5 entries in all
  - `is only the requester's` and `only for approved time off`
  - `has no offer without a project for the type, or for "Other"`
- [ ] **Step 2: Run** the unit spec and `pnpm test:int test/integration/time-off-logging.int-spec.ts -t Logging` — Expected: FAIL
- [ ] **Step 3: Implement** `workingDates` (the loop of `calculate`, collecting `getDateOnly(current)`) and `TimeOffLoggingService`; the entries are written by a new `TimeEntriesService.createForVacation(params: { userId; teamId: string | null; projectId; minutes; dates: string[]; vacationRequestId; slackTeamId }): Promise<number>` (one insert, status approved; no owner or assignment checks, which are for people's own logging, so an archived mapped project means `offerFor` returns null instead). The 24-hour rule needs no check of its own: a day with any time on the project is skipped, and a day's hours are at most 24.
- [ ] **Step 4: Run** both specs, `pnpm test`, `pnpm test:int` — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Log an approved vacation as time on its leave type's project"`

### Task 7: Offer it in Slack

**Files:**
- Modify: `src/slack/tabs/vacation-requests/services/vacation-decision-notifications.service.ts` (the requester's approved DM gets the button), `src/slack/enums/integration-callback-id.enum.ts` (`TimeOffLoggingOffer = 'time_off_logging_offer'`)
- Create: `src/slack/tabs/vacation-requests/services/time-off-offer.service.ts` (blocks of the offer, the DM job, `@OnEvent(VacationRequestEvent.Created)` / `Updated` for approved requests), `src/slack/tabs/vacation-requests/handlers/time-off-offer.handler.ts`
- Test: `test/integration/time-off-logging.int-spec.ts` (`describe('The offer')`)

**Interfaces:**
- Consumes: `TimeOffLoggingService.offerFor/log`
- Produces: `TimeOffOfferService.getBlocks(offer: ITimeOffOffer): AnyBlock[]` (an actions block, `block_id: ViewCallbackId.TimeOffLoggingOffer`, one button `action_id: 'log_time_off'`, `value: requestId`, text `Log {hours}h to {project}` with hours = days × per day, `getDisplayTime`); `TimeOffOfferService.sendOffer(requestId, slackTeamId)` (a job)

- [ ] **Step 1: Write the failing tests:**
  - `offers the button in the approved DM and logs on click` — approve a 5-day annual leave through the workflow → the requester's DM has button `'Log 40h to Vacations Paid'`; `actOnMessage` → 5 entries; the message is updated to `'✅ 40h logged to Vacations Paid.'`; skipped days listed when any
  - `offers it for time off HR approves directly` — HR creates an approved request (admin form) → a DM with the offer
  - `has no button without a project for the type, or when that project is archived`
  - `refuses someone else's click` — another user's forged click logs nothing (`ForbiddenException` answered in an ephemeral or DM per `SlackUserAccessFilter` rules)
  - `escapes the project name` — a project named `'<!here> PTO'` shows escaped
- [ ] **Step 2: Run** `pnpm test:int test/integration/time-off-logging.int-spec.ts -t 'The offer'` — Expected: FAIL
- [ ] **Step 3: Implement** the blocks, the DM job (`jobs.define`, idempotent: sends nothing when `offerFor` is null), the listeners (Created with status approved; Updated with status approved — Task 8 re-offers through it), the handler (`type: 'block_actions'`, `callbackId: ViewCallbackId.TimeOffLoggingOffer`, `allowedRoles: ALL_ROLES`) answering with `chat.update` of the message after `runInBackground` when slow.
- [ ] **Step 4: Run** the int spec, `pnpm test`, `pnpm lint` — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Offer to log approved time off as time"`

### Task 8: When the vacation changes

**Files:**
- Modify: `src/vacation-requests/vacation-requests.module.ts` (import `TimeEntriesModule`), `src/vacation-requests/services/vacation-requests.service.ts` (`update`, `delete` in a transaction with the cleanup), `src/time-entries/services/time-entries.service.ts`, the admin vacation edit/delete handlers (tell who changed it which days stay billed)
- Test: `test/integration/time-off-logging.int-spec.ts` (`describe('Changes after logging')`)

**Interfaces:**
- Produces: `TimeEntriesService.deleteVacationTime(requestId: string, slackTeamId: string, user: IUserViewModel): Promise<{ deleted: number; billedDates: string[] }>` (soft delete as `delete` does, billed ones kept); `VacationRequestsService.update/delete` return `{ request, billedDates }` (callers adapted)

- [ ] **Step 1: Write the failing tests:**
  - `removes the logged time when HR changes the dates, and offers again` — logged 5 days, HR moves the vacation a week → old entries deleted, the requester gets a new offer
  - `removes it when HR rejects or deletes the vacation`, without a new offer
  - `keeps billed days and says so` — two days in a billing snapshot → they stay; the HR form shows `'2 days stay logged: they are billed (17–18 Jun).'` as a notice
  - `keeps the hours and drops the link on a CSV import` — `user-vacations.csv` replacing the request → entries remain, `vacation_request_id` null
  - `does nothing for edits that change neither dates nor status`
- [ ] **Step 2: Run** `pnpm test:int test/integration/time-off-logging.int-spec.ts -t 'Changes after logging'` — Expected: FAIL
- [ ] **Step 3: Implement**: in `update`, when `start_date`, `end_date` or `status` changes, and in `delete`, run the change and `deleteVacationTime` in one `TransactionService.transaction`; the existing `Updated` event (after commit) re-offers through Task 7's listener when the request is still approved.
- [ ] **Step 4: Run** the int spec, `pnpm test`, `pnpm test:int` (the whole suite: vacation and import tests touch these paths) — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Remove a vacation's logged time when HR changes it"`

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md` (Time & Billing: the timesheet, the forms' rows and locks, time off as time, the new module), `CHANGELOG.md` (`## [Unreleased]` with both features), `README.md` only if it lists features

- [ ] **Step 1:** Write the sections; say the storage choice (`slack_teams.time_off_minutes_per_day`, table `time_off_projects`; projects are archived, never deleted, so a mapping ends by archiving, and only a workspace deletion cascades); mention the migration in CHANGELOG's Unreleased (it needs `db push` on update).
- [ ] **Step 2: Run** `pnpm lint` and `pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** `git commit -m "Describe the weekly timesheet and time off as time"`
