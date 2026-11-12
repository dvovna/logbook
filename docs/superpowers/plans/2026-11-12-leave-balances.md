# Leave balances and history from a file: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR brings each person's leave balance and dated leave into Logbook from two files the bot sends, with a preview, Apply and Undo, so balances are right on the day of the move.

**Architecture:**
- A balance from a file is stored as "N left on date D" (`leave_balances`) and applied on every read by one pure function, which both the per-person balance and the file planners use.
- The two files reuse part 1's flow: read with a shared CSV/Excel reader, planned by pure planners, kept in `leave_file_uploads` between the preview and Apply, applied under a workspace lock only when the plan is the one the clicked preview showed, and undone for 7 days where still unchanged.
- The Slack side mirrors `src/slack/team-file`.

**Tech Stack:** NestJS 11, TypeScript, Kysely 0.28 on Supabase Postgres, csv-parse, exceljs, Jest (unit and `test/integration`).

**Spec:** `docs/superpowers/specs/2026-11-12-leave-balances-design.md` (decisions are cited as D1–D30).

## Global Constraints

- `CLAUDE.md` is binding, including:
  - interfaces start with `I`;
  - every class member has explicit accessibility;
  - imports use `@modules/…`, `@common/…` or `src/…`, never `../`;
  - domain code doesn't import `src/slack`, and `src/common` imports no feature module;
  - only comments that explain something not obvious.
- Multi-row writes are `TransactionService` transactions. No Slack call inside one.
- `leaveFileLock` is a workspace lock, taken alone.
- Every repository query is scoped by `slack_team_id`.
- Domain dates are `YYYY-MM-DD` strings.
- Text people typed goes through `escapeMrkdwn`.
- Slack limits: 50 blocks per message, 3000 characters per section, at most 5 elements per actions block, no `**` Markdown. A long list ends with `…and N more`.
- Bot copy is English. Russian is only for talking to the user.
- A file is at most 1 MB (existing) and 5000 rows (`MAX_LEAVE_FILE_ROWS`).
- The preview and Undo windows are 7 days.
- A new foreign key gets an index starting with its columns in the same migration. New tables enable RLS. Run `pnpm db:types` after the migration.
- The round-trip budgets in `test/integration/round-trips.int-spec.ts` may grow in `statements` only by statements this plan adds beside others (in `Promise.all`). `roundTrips` never grows.
- Commits are short imperative one-liners with no trailers (the user's rule), e.g. `Read leave file dates per file`.
- The user asked for everything to be covered by tests: each task's tests are part of its deliverable.

## Review Focus

1. **Emails written differently from Slack's** (`Anna.Novak@Acme.com `). A row matches the person ignoring case and surrounding spaces, as in the team file. Tests: Task 7 and Task 8.
2. **A CSV saved by Excel** has a byte order mark, `;`, CRLF and trailing rows of empty cells (`;;;;;;`). It reads as the same rows, and the empty rows are neither data nor unusable. Test: Task 1.
3. **A request across the balance date or across the vacation year end.** Only its days from D, or within the year, count. Test: Task 4.
4. **A history row that exactly repeats a request already in Logbook.** It is skipped, not reported as an overlap. Test: Task 8.
5. **Two clicks on Apply** (two HR people, or a double click). The file applies once. Test: Task 12.

---

### Task 1: Shared spreadsheet reader

Moves the CSV/Excel reading out of the team file parser so the leave files use the same one.

**Files:**
- Create: `src/common/files/spreadsheet.reader.ts`, `src/common/files/spreadsheet.reader.spec.ts`
- Modify: `src/team-file/parsers/team-file.parser.ts`, `src/team-file/parsers/team-file.parser.spec.ts`, `src/slack/services/file-upload.service.ts`

**Interfaces:**
- Produces:
  - `interface ISpreadsheetLine { row: number; cells: string[] }`
  - `readSpreadsheet(content: Buffer, fileName: string): Promise<ISpreadsheetLine[]>`
    - Drops lines whose cells are all empty.
    - Throws `BadRequestException` with today's `UNREADABLE_FILE` and `NOT_UTF8` texts.
    - An Excel `Date` cell becomes `toISOString()`, as today.
  - `normalizeHeader(header: string): string`: no whitespace, lower case.
  - `columnsOf<C extends string>(header: ISpreadsheetLine | undefined, columnOfHeader: Map<string, C>): Map<C, number>`: the first match wins.
  - `cellAt(line: ISpreadsheetLine, index: number | undefined): string`: `fromCsvText` and trim, `''` for no column.
  - `parseTeamFile(lines: ISpreadsheetLine[]): ITeamFileRow[] | null`, which becomes synchronous and takes lines.

- [ ] **Step 1:** Move the reading cases of `team-file.parser.spec.ts` into `spreadsheet.reader.spec.ts`, then add these failing tests:

```ts
it('reads a CSV that Excel saved: byte order mark, semicolons, CRLF, empty rows', async () => {
  const csv = '﻿Name;Email\r\nAnna;anna@x.test\r\n;\r\n;;\r\n';
  expect(await readSpreadsheet(Buffer.from(csv), 'a.csv')).toEqual([
    { row: 1, cells: ['Name', 'Email'] },
    { row: 2, cells: ['Anna', 'anna@x.test'] },
  ]);
});
it('reads an Excel date cell as an ISO timestamp of that day', async () => {
  // a workbook built with exceljs whose B2 is new Date(Date.UTC(2026, 4, 4))
  expect((await readSpreadsheet(xlsx, 'a.xlsx'))[1].cells[1]).toBe('2026-05-04T00:00:00.000Z');
});
```

- [ ] **Step 2:** Run `pnpm test src/common/files src/team-file/parsers`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the reader by moving `readCsv`, `readExcel`, `textOfCell` and `decodeUtf8`. Make `parseTeamFile` take lines. In `FileUploadService.handleTeamFile`, call `readSpreadsheet` and then `parseTeamFile(lines)`; the reader's `BadRequestException` is answered as it is now.
- [ ] **Step 4:** Run `pnpm test src/common/files src/team-file && pnpm test:int test/integration/team-file.int-spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `Share the CSV and Excel reader of the team file`.

### Task 2: Dates and numbers of a leave file

**Files:**
- Create: `src/leave-file/parsers/leave-file-values.ts`, `src/leave-file/parsers/leave-file-values.spec.ts`

**Interfaces:**
- Produces:

```ts
export type DayCount =
  | { kind: 'empty' } | { kind: 'days'; value: number } | { kind: 'invalid' } | { kind: 'not-half' };
export const parseDays: (text: string) => DayCount;
export type SlashOrder = 'none' | 'dmy' | 'mdy' | 'ambiguous' | 'inconsistent';
export const slashOrderOf: (texts: string[]) => SlashOrder;
export type FileDate =
  | { kind: 'empty' } | { kind: 'date'; value: string }
  | { kind: 'invalid' } | { kind: 'ambiguous' } | { kind: 'inconsistent' };
export const parseFileDate: (text: string, order: SlashOrder) => FileDate;
```

Rules (D13, D15):
- **`parseDays`:**
  - The text is trimmed. `^-?\d+([.,]\d+)?$` is a number, with a comma read as a point.
  - A value that is not a multiple of 0.5 is `not-half`.
- **Dates accepted:**
  - `YYYY-MM-DD`, optionally followed by `T…` (an Excel cell): the first ten characters are taken;
  - `D.M.YYYY`;
  - `D/M/YYYY` or `M/D/YYYY`, with a 2-digit year read as 20YY.
- **Slash dates** follow `order`. `'none'` (which can't happen for a slash text) is read as `ambiguous`.
- **Invalid dates:** anything that isn't a real calendar day (`31.02.2026`), or matches no pattern, is `invalid`.
- **`slashOrderOf`** looks only at texts that match the slash pattern:
  - any first part over 12 means `dmy`; any second part over 12 means `mdy`;
  - both means `inconsistent`;
  - slash texts with neither mean `ambiguous`;
  - no slash texts mean `none`.

- [ ] **Step 1:** Write the failing table tests:

```ts
it.each([
  ['', { kind: 'empty' }], ['12', { kind: 'days', value: 12 }], ['12.5', { kind: 'days', value: 12.5 }],
  ['12,5', { kind: 'days', value: 12.5 }], ['-2', { kind: 'days', value: -2 }],
  ['12.3', { kind: 'not-half' }], ['twelve', { kind: 'invalid' }], ['1 2', { kind: 'invalid' }],
])('parseDays(%p)', (text, expected) => expect(parseDays(text)).toEqual(expected));

it.each([
  [['15/04/2021', '11/12/2026'], 'dmy'], [['4/15/2021', '11/12/2026'], 'mdy'],
  [['15/04/2021', '4/15/2021'], 'inconsistent'], [['5/4/2026', '11/12/2026'], 'ambiguous'],
  [['2026-11-12', '12.11.2026'], 'none'],
])('slashOrderOf(%p)', (texts, expected) => expect(slashOrderOf(texts)).toBe(expected));

it.each([
  ['2026-05-04', 'none', '2026-05-04'], ['2026-05-04T00:00:00.000Z', 'none', '2026-05-04'],
  ['4.5.2026', 'none', '2026-05-04'], ['04/05/2026', 'dmy', '2026-05-04'],
  ['05/04/2026', 'mdy', '2026-05-04'], ['5/4/26', 'mdy', '2026-05-04'], ['29.02.2028', 'none', '2028-02-29'],
])('parseFileDate(%p, %p)', (text, order, value) =>
  expect(parseFileDate(text, order as SlashOrder)).toEqual({ kind: 'date', value }));

it.each([
  ['31.02.2026', 'none', 'invalid'], ['2026-13-01', 'none', 'invalid'], ['soon', 'none', 'invalid'],
  ['05/04/2026', 'ambiguous', 'ambiguous'], ['05/04/2026', 'inconsistent', 'inconsistent'],
  ['05/04/2026', 'none', 'ambiguous'],
])('parseFileDate(%p, %p) is %p', (text, order, kind) =>
  expect(parseFileDate(text, order as SlashOrder)).toEqual({ kind }));
```

- [ ] **Step 2:** Run `pnpm test src/leave-file/parsers/leave-file-values.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the three functions.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Read leave file dates and days, slash dates per file`.

### Task 3: Schema, repositories and the lock

**Files:**
- Create:
  - `supabase/migrations/20261113100000_leave_file.sql`
  - `src/vacation-requests/repositories/leave-balances.repository.ts`
  - `src/vacation-requests/types/leave-balance.interface.ts`
  - `src/leave-file/repositories/leave-file-uploads.repository.ts`
  - `src/leave-file/types/leave-file-upload.interface.ts`
  - `src/leave-file/enums/leave-file-kind.enum.ts`
  - `src/leave-file/enums/leave-file-upload-status.enum.ts`
- Modify:
  - `src/common/types/database.types.ts` (generated)
  - `src/database/advisory-locks.ts`
  - `src/vacation-requests/repositories/vacation-requests.repository.ts`
  - `src/vacation-requests/types/vacation-request.interface.ts`

**Interfaces:**
- Produces:
  - **Migration.** Tables as in the spec's builder notes:
    - `leave_file_uploads`: the columns of `team_file_uploads` plus `kind text not null check (kind in ('balances','history'))`. Index `(slack_team_id, kind, status, applied_at desc)`, and `(uploaded_by) where uploaded_by is not null`.
    - `leave_balances`:
      - `id uuid pk`, `slack_team_id` (FK, cascade);
      - `user_id` (FK `users`, cascade, **unique**: one balance per person);
      - `balance_on date not null`, `days_left numeric(5,1)`, `working_days_left numeric(5,1)`, `bonus_days_left numeric(5,1)`. A check makes each a multiple of 0.5, and another requires at least one not null;
      - `upload_id` (FK `leave_file_uploads`, set null), `set_by` (FK `users`, set null), `created_at`, `updated_at`.
      - Indexes: `(slack_team_id)`, `(upload_id) where not null`, `(set_by) where not null`.
    - `vacation_requests.leave_file_upload_id uuid` (FK `leave_file_uploads`, set null), with an index `where not null`.
    - RLS is enabled on both tables, and every table has a comment.
  - `ILeaveBalance { id; slack_team_id; user_id; balance_on: string; days_left: number | null; working_days_left: number | null; bonus_days_left: number | null; upload_id: string | null; set_by: string | null; created_at: string; updated_at: string }`
  - `LeaveBalancesRepository extends BaseRepository<'leave_balances', ILeaveBalance>`
  - `enum LeaveFileKind { Balances = 'balances', History = 'history' }`. `enum LeaveFileUploadStatus` has the same values as `TeamFileUploadStatus`.
  - `ILeaveFileUpload`: `ITeamFileUpload`'s fields plus `kind: LeaveFileKind`, with `rows: unknown[]` and `undo: ILeaveFileUndo | null` (the type is defined in Task 9; use `unknown` until then).
  - `LeaveFileUploadsRepository` with:
    - `supersedePreviewed(slackTeamId, kind)`;
    - `cancelPreviewed(id, slackTeamId): Promise<ILeaveFileUpload | null>`;
    - `setMessage(id, slackTeamId, channel, ts)`;
    - `setDigest(id, slackTeamId, digest)`;
    - `markApplied(id, slackTeamId, undo)`;
    - `markUndone(id, slackTeamId)`;
    - `hasApplied(slackTeamId): Promise<boolean>`.

    They are conditional exactly as `TeamFileUploadsRepository`'s.
  - `leaveFileLock(slackTeamId): IAdvisoryLock`: key `leave-file:<id>`, rank 65 (between `teamFile` and `singletonJob`).
  - `IVacationRequestViewModel.leave_file_upload_id: string | null`, mapped in `mapToViewModel`.

- [ ] **Step 1:** Write the migration. Then run `pnpm db:init && pnpm db:types`. Expected: the types file gains the two tables and the column.
- [ ] **Step 2:** Run `pnpm test:int test/integration/schema.int-spec.ts`. Expected: PASS: every foreign key has its index.
- [ ] **Step 3:** Add the repositories, types, enums and the lock. Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 4:** Commit: `Add leave file uploads and leave balances`.

### Task 4: The balance with a file balance

**Files:**
- Create:
  - `src/vacation-requests/utils/leave-balance.utils.ts`, `src/vacation-requests/utils/leave-balance.utils.spec.ts`
  - `src/vacation-requests/services/leave-balances.service.ts`
  - `test/integration/leave-balance.int-spec.ts`
- Modify:
  - `src/vacation-requests/services/vacation-period-usage.service.ts`
  - `src/vacation-requests/services/vacation-usage.service.ts`, `vacation-usage.service.spec.ts`
  - `src/vacation-requests/vacation-requests.module.ts`
  - `test/integration/round-trips.int-spec.ts` (statements only)

**Interfaces:**
- Consumes: `ILeaveBalance`, `LeaveBalancesRepository` (Task 3).
- Produces:

```ts
// One of the person's approved or pending requests with the working days it takes.
export interface ICountedRequest {
  id: string; status: VacationRequestStatus; type: VacationType;
  startDate: string; endDate: string; workingDates: string[];
}
export interface IFileBalance {
  balanceOn: string; daysLeft: number | null; workingDaysLeft: number | null; bonusDaysLeft: number | null;
}
export interface ILeaveBalanceInput {
  contractStartDate: string | null; createdAt: string; carryoverDays: number | null;
  policy: IVacationPolicyViewModel | null; requests: ICountedRequest[];
  fileBalance: IFileBalance | null; date: Date; today: Date;
}
export interface ILeft { days: number; workingDays: number; bonusDays: number }
export const leaveBalanceOf: (input: ILeaveBalanceInput) => IVacationPeriodUsageData;
// The days whose requests leaveBalanceOf needs.
export const requestWindowOf: (input: Omit<ILeaveBalanceInput, 'requests'>) => { from: Date; to: Date };
// Left on `on` before any leave from `on`, without a file balance; the leave from `on` to the
// year's end and what it takes. Null without a policy.
export const countedOn: (input: Omit<ILeaveBalanceInput, 'fileBalance' | 'date'>, on: string) =>
  { left: ILeft; usedFrom: ILeft; planned: ICountedRequest[] } | null;
```

- `IVacationLimits` gains `correction: { balanceOn: string; days: number; workingDays: number; bonusDays: number } | null`. It is set only in the year that holds `balanceOn`, with 0 for a unit the file left empty.
- `VacationPeriodUsageService`:
  - `countedRequests(user, from: Date, to: Date, options?: { excludeRequestId?; ownRules? }): Promise<ICountedRequest[]>` replaces `getUsageByPeriods`, which only `VacationsUsageService` uses;
  - `countedRequestsOfUsers(users: IUserViewModel[], from: Date, to: Date): Promise<Map<string, ICountedRequest[]>>` makes one request read, one rules read (`forWorkspace`) and one holidays read (`holidayDatesByPolicy`), whatever the number of users. The planners need it.
- `LeaveBalancesService`:
  - `findOfUser(userId, slackTeamId): Promise<ILeaveBalance | null>`;
  - `findOfUsers(userIds, slackTeamId): Promise<ILeaveBalance[]>`;
  - `setMany(balances: (IFileBalance & { userId: string })[], uploadId: string, setBy: IUserViewModel): Promise<ILeaveBalance[]>`: one upsert on `user_id`;
  - `restoreMany(restores: { userId: string; uploadId: string; updatedAt: string; before: IFileBalance | null }[], slackTeamId): Promise<string[]>`: the user IDs restored, each only while its row still has that `upload_id` and `updated_at`. `before: null` deletes the row.
- `toFileBalance(balance: ILeaveBalance): IFileBalance`.

The algorithm `leaveBalanceOf` must follow (D11, D30). The carryover today is `carryoverInto`; this replaces it:
- **Years.** `P(d) = getCurrentVacationPeriod(contractStartDate, d)`.
  - The target year is `T = P(date)`.
  - The joined year is `J = getJoinedVacationPeriod(contractStartDate, createdAt, today)`.
  - The balance's year is `B = P(balanceOn)` when there is a file balance.
- **No policy:** `limits` is null and usage is counted as today.
- **Future year:** if `T.start > today`, there is no carryover and no correction (as today).
- **Where the chain starts:** `S = (B && B.start <= T.start) ? min(B.start, J.start) : J.start`. If `T.start < S`, there is no carryover.
- **Each year `y` from `S` to `T`,** for the calendar and the working unit apart:
  - `carry(S) = S === J.start ? min(carryoverDays ?? 0, most) : 0`, where `most = policy.carryover_days`;
  - `corr(y) = (y === B && N != null) ? N − (allowance + carry(y) − usedBefore(y, balanceOn)) : 0`;
  - `left(y) = allowance + carry(y) + corr(y) − used(y)`;
  - `carry(y+1) = clamp(left(y), 0, most)`.
- **Bonus days** have no carryover: `corr = (T === B && N != null) ? N − (bonus_days − bonusUsedBefore(balanceOn)) : 0`.
- **Available in `T`:** `allowance + carry + corr − used`, shown as 0 when negative (as today).
- **Counting days:** a request counts only its days inside the period. `usedBefore(y, d)` counts days from `y.start` up to the day before `d`.
- **The request read:** `VacationsUsageService.getVacationPeriodUsage` reads the file balance beside the policy and the requests (`Promise.all`). When `B.start` is earlier than the read window, it reads the requests again from `B.start`. That happens only after a contract start moved.

- [ ] **Step 1: Write the failing unit tests.** Use policy `{ vacation_days: 26, working_days: 20, carryover_days: 5, bonus_days: 3 }`, no contract start, `createdAt` `2026-01-01`, today `2026-11-12`, no holidays, and annual leave Mar 2–11, 2026 (10 days, 8 working).
  - The spec's helpers:
    - `balanceOf(overrides)` builds `ILeaveBalanceInput` from these defaults, with `extra` adding requests and dates given as strings, and returns `leaveBalanceOf(...)`;
    - `input(overrides)` builds the same without calling it;
    - `file(partial)` is an `IFileBalance` on `2026-11-12`;
    - `annual(r)` is `{ available: r.usage.annual_leave.available, working: r.usage.annual_leave.working_days_available, correction: r.limits?.correction ?? null }`;
    - `bonus(r)` is `{ available: r.usage.bonus_day.available, correction: r.limits!.correction?.bonusDays ?? 0 }`.

```ts
it('without a file balance, as today', () =>
  expect(annual(balanceOf({}))).toEqual({ available: 16, working: 12, correction: null }));
it('a file balance on Nov 12 is what is left, and the difference is its correction', () =>
  expect(annual(balanceOf({ fileBalance: file({ daysLeft: 12 }) }))).toEqual({
    available: 12, working: 12, correction: { balanceOn: '2026-11-12', days: -4, workingDays: 0, bonusDays: 0 } }));
it('takes leave from the balance date on from it', () =>   // + annual leave Dec 21–31 (11 days)
  expect(annual(balanceOf({ fileBalance: file({ daysLeft: 12 }), extra: [dec21to31] })).available).toBe(1));
it('counts a request across the balance date from that date', () =>   // annual leave Nov 10–13
  expect(annual(balanceOf({ fileBalance: file({ daysLeft: 12 }), extra: [nov10to13] })).available).toBe(10));
it('counts a request across the year end only inside the year', () =>   // Dec 28, 2026 – Jan 3, 2027
  expect(annual(balanceOf({ fileBalance: file({ daysLeft: 12 }), extra: [dec28toJan3] })).available).toBe(8));
it('a working days balance leaves calendar days to the dates', () =>
  expect(annual(balanceOf({ fileBalance: file({ workingDaysLeft: 7 }) }))).toMatchObject({ available: 16, working: 7 }));
it('a bonus days balance', () =>   // + bonus day Apr 6
  expect(bonus(balanceOf({ fileBalance: file({ bonusDaysLeft: 2 }), extra: [apr6bonus] }))).toEqual({ available: 2, correction: 0 }));
it('half a day', () => expect(annual(balanceOf({ fileBalance: file({ daysLeft: 12.5 }) })).available).toBe(12.5));
it('a negative balance shows 0 and carries nothing', () => {
  expect(annual(balanceOf({ fileBalance: file({ daysLeft: -2 }) })).available).toBe(0);
  expect(balanceOf({ fileBalance: file({ daysLeft: -2 }), date: '2027-03-01', today: '2027-03-01' }).limits!.carryoverDays).toBe(0);
});
it('next year carries over from the file balance, up to the policy', () =>
  expect(balanceOf({ fileBalance: file({ daysLeft: 12 }), date: '2027-03-01', today: '2027-03-01' }).limits)
    .toMatchObject({ carryoverDays: 5, correction: null }));
it('a balance whose date a moved contract start puts in the year before carries over', () =>
  // contract start 2020-11-10: the current year starts 2026-11-10, and the balance of Nov 5 falls in the year before
  expect(balanceOf({ contractStartDate: '2020-11-10', fileBalance: file({ daysLeft: 12, balanceOn: '2026-11-05' }), extra: [] }).limits)
    .toMatchObject({ carryoverDays: 5, correction: null }));
it('ignores a file balance of a later year than the one asked', () =>
  expect(balanceOf({ fileBalance: file({ daysLeft: 12 }), date: '2025-06-01' }).limits!.correction).toBeNull());
it('has no limits without a policy', () => expect(balanceOf({ policy: null, fileBalance: file({ daysLeft: 12 }) }).limits).toBeNull());
it('countedOn: left before Nov 12 and the leave from it', () =>
  expect(countedOn(input({ extra: [dec21to31] }), '2026-11-12')).toEqual({
    left: { days: 16, workingDays: 12, bonusDays: 3 }, usedFrom: { days: 11, workingDays: 9, bonusDays: 0 },
    planned: [expect.objectContaining({ startDate: '2026-12-21', endDate: '2026-12-31' })] }));
```

- [ ] **Step 2:** Run `pnpm test src/vacation-requests/utils/leave-balance.utils.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `leave-balance.utils.ts`. Then switch `VacationsUsageService` and `VacationPeriodUsageService` to it, delete `carryoverInto` and `getUsageByPeriods`, and add `LeaveBalancesService` to the module. Keep `vacation-usage.service.spec.ts`'s existing cases passing, adding the file balance read to its mocks.
- [ ] **Step 4: Write the failing integration tests** in `leave-balance.int-spec.ts`. Each inserts a `leave_balances` row with `t.db`:
  - `refuses a request above the file balance`: daysLeft 12 on `2026-06-17`, annual leave Mar 2–11 in Logbook, a request of 13 days in July. Expected: the form's error `Not enough vacation days. Requested: 13, available: 12`.
  - `takes a request from the balance date on from it`: after an approved request of 5 days in July, a request of 8 days is refused with `available: 7`.
  - `ignores the profile's carryover in the year of a file balance`: `carryover_days` 5 changes nothing, and a request of 13 is still refused.
- [ ] **Step 5:** Run `pnpm test src/vacation-requests && pnpm test:int test/integration/leave-balance.int-spec.ts test/integration/vacation-balance.int-spec.ts test/integration/round-trips.int-spec.ts`. Expected: PASS once the round-trip `statements` of the screens that show a balance are raised by the one balance read added beside the others. `roundTrips` stays the same.
- [ ] **Step 6:** Commit: `Count a balance from a file on every read`.

### Task 5: Showing a balance from a file

**Files:**
- Modify:
  - `src/slack/tabs/home/views/home-tab.view.ts`
  - `src/slack/tabs/users/views/user-vacation-usage-modal.view.ts`
  - `src/slack/tabs/users/views/edit-user-modal.view.ts` and the service that opens it (`src/slack/tabs/users/services/users-tab.service.ts`)
  - `src/slack/tabs/vacation-requests/services/vacation-history-tab.service.ts`, `views/vacation-history-tab.view.ts`
- Test: `test/integration/leave-balance.int-spec.ts`

**Interfaces:**
- Consumes: `IVacationLimits.correction`, `LeaveBalancesService.findOfUser` (Task 4).
- Produces this copy (D4, D19), with signed numbers written `+3` or `-4`:
  - **Home, annual leave:** today's details plus `*-4* correction` when the calendar correction isn't 0, and `*+2* working correction` when the working one isn't. Under the section, a context block: `Set from a file: 12 days, 7 working days, 2 bonus days left on Nov 12, 2026.` It names only the units the file gave.
  - **Home, bonus days:** `*-1* correction` in the details.
  - **People → usage modal:** after `Available: …`, the same correction words, and the same context line.
  - **Edit-user carryover hint,** when the person has a file balance whose year is the joined year or later: `This year's balance comes from a file (12 days left on Nov 12, 2026), so carryover here changes nothing.`
  - **Time off history:** the same `Set from a file: …` line as the first context block under `*Your requests*`. The tab reads `getCurrentVacationPeriodUsage` beside its own reads.

- [ ] **Step 1: Write failing integration tests.** Each compares whole section and context texts, read with `tab-readers`:
  - Home shows the correction and the "Set from a file" line;
  - the People usage modal shows them;
  - the edit-user modal's carryover hint says so;
  - Time off history shows the line;
  - with no file balance, none of these appears.
- [ ] **Step 2:** Run `pnpm test:int test/integration/leave-balance.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the views and the reads.
- [ ] **Step 4:** Run the same test, `pnpm test src/slack` and `pnpm test:int test/integration/round-trips.int-spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `Show a balance from a file and its correction`.

### Task 6: Recognizing a leave file

**Files:**
- Create:
  - `src/leave-file/constants/leave-file-headers.ts`, `src/leave-file/constants/leave-file-limits.ts`
  - `src/leave-file/types/leave-file-row.interface.ts`
  - `src/leave-file/parsers/leave-file.parser.ts`, `src/leave-file/parsers/leave-file.parser.spec.ts`

**Interfaces:**
- Consumes: `ISpreadsheetLine`, `normalizeHeader`, `columnsOf`, `cellAt` (Task 1).
- Produces:
  - `BALANCES_HEADERS = ['Name','Email','Contract start','Balance on','Days left','Working days left','Bonus days left'] as const`
  - `HISTORY_HEADERS = ['Name','Email','Leave type','From','To','Comment'] as const`
  - `MAX_LEAVE_FILE_ROWS = 5000`, `LEAVE_FILE_PREVIEW_DAYS = 7`, `LEAVE_FILE_UNDO_DAYS = 7`, `MAX_LEAVE_AHEAD_DAYS = 366`
  - `ILeaveBalanceRow { row; name; email; contractStart; balanceOn; daysLeft; workingDaysLeft; bonusDaysLeft }`: every field but `row` is the cell's text.
  - `ILeaveHistoryRow { row; name; email; leaveType; from; to; comment }`
  - `type ILeaveFile = { kind: LeaveFileKind.Balances; rows: ILeaveBalanceRow[] } | { kind: LeaveFileKind.History; rows: ILeaveHistoryRow[] }`
  - `parseLeaveFile(lines: ISpreadsheetLine[]): ILeaveFile | null` (D28):
    - **history** needs Email, Leave type, From and To;
    - **balances** needs Email, at least one of the other balance columns, and no Team column;
    - otherwise null.

    More than `MAX_LEAVE_FILE_ROWS` data rows throws `BadRequestException('A leave file can have up to 5000 rows.')`.

- [ ] **Step 1:** Write failing tests:
  - both kinds recognized from their templates' headers;
  - headers matched ignoring case and spaces (`days LEFT`);
  - a missing optional column reads as `''`;
  - a header with Email and Team is null;
  - Email alone is null;
  - row numbers are kept;
  - 5001 rows throw with the message above.
- [ ] **Step 2:** Run `pnpm test src/leave-file/parsers`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Recognize leave balance and history files`.

### Task 7: Planning a balances file

**Files:**
- Create:
  - `src/common/utils/digest.utils.ts`
  - `src/leave-file/constants/leave-file-unusable-reasons.ts`
  - `src/leave-file/types/leave-balances-plan.interface.ts`
  - `src/leave-file/services/leave-balances-planner.ts`, `src/leave-file/services/leave-balances-planner.spec.ts`
- Modify: `src/team-file/services/team-file-planner.ts` (its `planDigest` calls `digestOf`)

**Interfaces:**
- Consumes: `parseDays`, `slashOrderOf`, `parseFileDate` (Task 2); `countedOn`, `ICountedRequest`, `ILeft` (Task 4); `ILeaveBalanceRow` (Task 6).
- Produces:
  - `digestOf(value: unknown): string`: the team file's canonical JSON sha256, moved.
  - `ILeaveBalancesState { today: string; people: IUserViewModel[]; policyOf: Map<string, IVacationPolicyViewModel | null>; requestsOf: Map<string, ICountedRequest[]>; balanceOf: Map<string, IFileBalance> }`. `people` includes inactive people, and `balanceOf` holds the earlier file balances.
  - `ILeaveBalancesPlan`:

```ts
{
  balances: { userId: string; balanceOn: string; daysLeft: number | null; workingDaysLeft: number | null;
    bonusDaysLeft: number | null; counted: ILeft;
    planned: { type: VacationType; startDate: string; endDate: string }[];
    after: { days: number | null; workingDays: number | null; bonusDays: number | null } }[];
  contractStarts: { userId: string; before: string | null; after: string }[];
  unchanged: number;
  unusable: { row: number; reason: string }[];
}
```

  - `planLeaveBalances(rows: ILeaveBalanceRow[], state: ILeaveBalancesState): ILeaveBalancesPlan`
  - `balancesPlanChangesNothing(plan): boolean`
  - `LEAVE_FILE_UNUSABLE_REASONS`, exact copy:

```ts
noEmail: 'Row has no email',
notInWorkspace: (email) => `${email} isn't in this Slack workspace`,
deactivated: (name) => `${name} is deactivated`,
duplicate: (name, row) => `${name} is already on row ${row}`,
invalidDate: (column, text) => `${column} "${text}" isn't a date: write it as 2026-11-12`,
ambiguousDate: (column, text) => `${column} "${text}" could be day/month or month/day: write dates as 2026-11-12 or save the file as Excel`,
inconsistentDates: (column, text) => `${column} "${text}": the file's dates with / mix day/month and month/day; write dates as 2026-11-12`,
invalidDays: (column, text) => `${column} "${text}" isn't a number of days`,
notHalf: (column, text) => `${column} "${text}": Logbook counts whole and half days`,
balanceOnFuture: (text) => `Balance on ${text} is after today`,
balanceOnOutsideYear: (name, yearStart) => `Balance on must fall in ${name}'s current vacation year, which starts ${yearStart}`,
noPolicy: (name) => `${name} follows no vacation policy, so there is no balance to set. Set a policy first.`,
```

  `yearStart` is `formatDate(…)`, and `name` is the row's Name or else its email.

- **Rules,** in this order per row:
  1. **The person.** The email is matched ignoring case and surrounding spaces. Unknown → `notInWorkspace`; inactive → `deactivated`; the person's second row → `duplicate`.
  2. **Contract start.** The slash order is computed over every Contract start and Balance on cell of the file. A bad contract start makes the row unusable, with the reason of its `FileDate` kind. An empty one keeps the current value.
  3. **Balance on.** Empty means `state.today`. A bad date, a date after today, or a date outside the current vacation year are each unusable, with that row's contract start (new or kept) setting the year.
  4. **The three day counts.** `invalid` or `not-half` makes the row unusable.
  5. **No policy.** When any count is given and there is no policy, the count part is listed as `noPolicy`, and a changed contract start still applies (D27).
  6. **Nothing to set.** A row that sets nothing counts in `unchanged`.
  7. **An earlier file balance.** An empty count keeps the earlier balance's value when the row's Balance on is that balance's date (D14). On another date the row's balance replaces it whole, since the earlier counts were left on another day. The plan's counts are the merged ones.
- `counted` comes from `countedOn` with the row's contract start, on `balanceOn`. `after` is each given count minus `usedFrom` for that unit.
- A `contractStarts` entry is made only when the date changes.

- [ ] **Step 1: Write failing tests.** Use the Task 4 policy and leave Mar 2–11, with `today` `2026-11-12`:

```ts
it('plans a balance with what Logbook counts and the leave after it', () =>
  expect(plan([row({ daysLeft: '12' })], state({ extra: [dec21to31] })).balances).toEqual([{
    userId: anna.id, balanceOn: '2026-11-12', daysLeft: 12, workingDaysLeft: null, bonusDaysLeft: null,
    counted: { days: 16, workingDays: 12, bonusDays: 3 },
    planned: [{ type: VacationType.AnnualLeave, startDate: '2026-12-21', endDate: '2026-12-31' }],
    after: { days: 1, workingDays: null, bonusDays: null } }]));
it('matches an email ignoring case and spaces', () =>
  expect(plan([row({ email: ' Anna.Novak@Acme.test ', daysLeft: '12' })], state()).unusable).toEqual([]));
it('reads slash dates of the whole file the same way', () =>
  expect(plan([row({ contractStart: '4/15/2021', balanceOn: '11/12/2026', daysLeft: '12' })], state()).contractStarts)
    .toEqual([{ userId: anna.id, before: null, after: '2021-04-15' }]));
it('keeps the earlier working days of a balance on the same date', () =>
  expect(plan([row({ daysLeft: '12' })], state({ balanceOf: { workingDaysLeft: 7, balanceOn: '2026-11-12' } })).balances[0])
    .toMatchObject({ daysLeft: 12, workingDaysLeft: 7 }));
```

  Add one test per reason above. Also test:
  - empty Balance on means today;
  - `12,5` is read as 12.5;
  - a no-policy row with a contract start gives a `contractStarts` entry and the `noPolicy` reason;
  - an all-empty row only counts in `unchanged`;
  - `digestOf` gives the same digest for the same plan with its lists reordered.
- [ ] **Step 2:** Run `pnpm test src/leave-file/services/leave-balances-planner.spec.ts src/team-file`. Expected: FAIL in the new spec only.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Plan a leave balances file`.

### Task 8: Planning a history file

**Files:**
- Create:
  - `src/leave-file/constants/leave-file-type-names.ts`
  - `src/leave-file/types/leave-history-plan.interface.ts`
  - `src/leave-file/services/leave-history-planner.ts`, `src/leave-file/services/leave-history-planner.spec.ts`
- Modify: `src/leave-file/constants/leave-file-unusable-reasons.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6 and 7 (reasons, `IFileBalance`, `leaveBalanceOf`).
- Produces:
  - `LEAVE_FILE_TYPE_NAMES: Record<VacationType, string>` = Annual leave, Bonus day, Sick leave, Unpaid leave, Other (D21). Domain code doesn't import `labels.ts`; Task 12 tests that the two agree.
  - `ILeaveHistoryState { today: string; people: IUserViewModel[]; policyOf; requestsOf: Map<string, ICountedRequest[]>; balanceOf: Map<string, IFileBalance>; workingDatesOf: (userId: string, startDate: string, endDate: string) => string[] }`
  - `ILeaveHistoryPlan`:

```ts
{
  add: { row: number; userId: string; type: VacationType; startDate: string; endDate: string; comment: string | null }[];
  skipped: number;
  balanceChanges: { userId: string; before: ILeft; after: ILeft }[];
  plannedLeave: { userId: string; balanceOn: string;
    leave: { type: VacationType; startDate: string; endDate: string }[];
    after: { days: number | null; workingDays: number | null; bonusDays: number | null } }[];
  unusable: { row: number; reason: string }[];
}
```

  - `planLeaveHistory(rows: ILeaveHistoryRow[], state: ILeaveHistoryState): ILeaveHistoryPlan`
  - `historyPlanChangesNothing(plan): boolean`
  - More reasons, exact copy:

```ts
unknownType: (text) => `"${text}" is not a leave type (use Annual leave, Bonus day, Sick leave, Unpaid leave or Other)`,
missingDates: 'From and To are both needed',
endsBeforeStart: 'To is before From',
tooFarAhead: (text) => `To ${text} is more than a year ahead`,
commentTooLong: `Comment is longer than ${MAX_COMMENT_LENGTH} characters`,
overlapsRequest: (name, typeName, range) => `overlaps ${name}'s ${typeName} ${range}`,
overlapsRow: (row) => `overlaps row ${row}`,
```

  `range` is `formatDateRange`, and `typeName` is the lower-cased `LEAVE_FILE_TYPE_NAMES` value.

- **Rules,** in this order per row:
  1. **The person:** as in Task 7. A person may have many rows.
  2. **The type:** matches a name or a `VacationType` value, ignoring case and spaces.
  3. **The dates:** From and To use the slash order of every From and To cell of the file. To later than `today + MAX_LEAVE_AHEAD_DAYS` is `tooFarAhead`.
  4. **The comment:** at most `MAX_COMMENT_LENGTH` characters.
  5. **Already in Logbook:** a row with the same type, start and end as one of the person's approved or pending requests is skipped and counts in `skipped`. This is checked before overlaps.
  6. **Overlaps:** an overlap with an approved or pending request is `overlapsRequest`. An overlap with an earlier usable row of the file is `overlapsRow`.
  7. **Otherwise** the row is added.
- **Who has a file balance.** For people with no file balance, `balanceChanges` compares `leaveBalanceOf` on today before and after the added rows, listing a person only when annual or bonus availability changes. For people with one, `plannedLeave` lists the added leave from its date with what is left after it. The added rows count with `workingDatesOf`.

- [ ] **Step 1:** Write failing tests:
  - one per reason;
  - type names in any case, and `annual_leave`;
  - an exact repeat of an existing approved request is skipped and not unusable (Review Focus 4);
  - two overlapping rows: the second is `overlaps row N`;
  - email case (Review Focus 1);
  - `balanceChanges` for a person without a file balance and no leave yet: `26 → 16` days, for 10 days of annual leave;
  - `plannedLeave` for a person with daysLeft 12 and added Dec 21–31: `after.days` 1. Their leave before the date gives no `balanceChanges` line.
- [ ] **Step 2:** Run `pnpm test src/leave-file/services/leave-history-planner.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `Plan a leave history file`.

### Task 9: Receiving and applying a leave file

**Files:**
- Create:
  - `src/leave-file/leave-file.module.ts`
  - `src/leave-file/services/leave-file-state.service.ts`
  - `src/leave-file/services/leave-file-uploads.service.ts`, `src/leave-file/services/leave-file-uploads.service.spec.ts`
  - `src/leave-file/types/leave-file-undo.interface.ts`, `src/leave-file/types/leave-file-apply-result.interface.ts`
- Modify:
  - `src/vacation-requests/services/vacation-requests.service.ts` (+ spec)
  - `src/app.module.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7 and 8.
- Produces:
  - `LeaveFileStateService.balancesState(slackTeamId): Promise<ILeaveBalancesState>` and `historyState(slackTeamId, rows: ILeaveHistoryRow[]): Promise<ILeaveHistoryState>`. Each reads in parallel on the pool:
    - people (inactive included), `forWorkspace`, the policies;
    - `countedRequestsOfUsers` over `[min(earliest date in the file, today − 2 years), max(latest date in the file, today + 2 years)]`;
    - the file balances;
    - the holidays (`holidayDatesByPolicy`).

    A person's policy is their team's (`forWorkspace`), or the company rules' for no team.
  - `ILeaveFileUndo`:

```ts
| { kind: LeaveFileKind.History; requests: { id: string; updatedAt: string }[] }
| { kind: LeaveFileKind.Balances;
    balances: { userId: string; before: IFileBalance | null; updatedAt: string }[];
    contractStarts: { userId: string; before: string | null; after: string }[] }
```

  - `ILeaveFilePreview = { kind: LeaveFileKind.Balances; plan: ILeaveBalancesPlan; people: IUserViewModel[] } | { kind: LeaveFileKind.History; plan: ILeaveHistoryPlan; people: IUserViewModel[] }`
  - `ILeaveFileApplyResult = { kind: 'applied' | 'changed' | 'nothing'; preview: ILeaveFilePreview; upload: ILeaveFileUpload } | { kind: 'closed'; status: LeaveFileUploadStatus | 'expired'; upload: ILeaveFileUpload }`
  - `LeaveFileUploadsService`:
    - `receive(file: ILeaveFile, fileName: string, user): Promise<{ upload: ILeaveFileUpload; preview: ILeaveFilePreview }>`: under `leaveFileLock`, it supersedes the open preview of the same kind;
    - `setMessage(uploadId, slackTeamId, channel, ts)`;
    - `cancel(uploadId, user)`;
    - `apply(uploadId, shownDigest, user): Promise<ILeaveFileApplyResult>`;
    - `hasApplied(slackTeamId): Promise<boolean>`;
    - `findImport(uploadId, slackTeamId): Promise<{ fileName: string; uploadedBy: IUserViewModel | null; appliedAt: string } | null>`.

    `apply` behaves as `TeamFileUploadsService.apply`, with the same `NotFoundException('This preview is no longer open.')` and an ID checked against `UPLOAD_ID_PATTERN`:
    - **History:** `addImported`, with undo `requests` taken from the returned rows' `updated_at`.
    - **Balances:** `LeaveBalancesService.setMany` and `UsersService.setContractStartDates`, with undo `balances`. Its `before` is the person's earlier file balance or null, and its `updatedAt` is the new row's.
  - `VacationRequestsService.addImported(leaves: { userId: string; teamId: string | null; type: VacationType; startDate: string; endDate: string; comment: string | null }[], importedBy: IUserViewModel, uploadId: string): Promise<IVacationRequestViewModel[]>`:
    - inserts `approved` rows with `leave_file_upload_id`, `user_comment`, `created_by`/`updated_by` = `importedBy`;
    - computes `days` and `working_days` with `readHolidaysOfTeams`;
    - writes chunks of `INSERT_CHUNK_ROWS`, inside the caller's transaction;
    - emits no event.

    Each leave's `teamId` is the person's current team (D22).

- [ ] **Step 1:** Write failing unit tests with `jest.fn()` mocks, as in `team-file-uploads.service.spec.ts`:
  - a bad upload ID or an upload of another workspace → NotFound;
  - not previewed → `closed` with its status;
  - older than 7 days → `closed` `expired`;
  - a digest other than the clicked one → `changed`, and the new digest is stored;
  - an unchanged plan that changes nothing → `nothing`, with no writes;
  - history applied → `addImported` with the plan's rows and the person's team, then `markApplied` with the undo;
  - balances applied → `setMany` and `setContractStartDates` with the plan, and the undo holds the earlier balance.

  For `addImported` (in `vacation-requests.service.spec.ts`): 2001 leaves are inserted in two `createMany` calls with `status: 'approved'`, the upload ID, and days from the holidays.
- [ ] **Step 2:** Run `pnpm test src/leave-file src/vacation-requests/services/vacation-requests.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, and register `LeaveFileModule` (imports `UsersModule`, `TeamsModule`, `VacationRequestsModule`, `VacationPoliciesModule`) in `AppModule`.
- [ ] **Step 4:** Run the same command and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit: `Receive and apply leave files`.

### Task 10: Undoing a leave file

**Files:**
- Create: `src/leave-file/services/leave-file-undo.service.ts` (+ spec), `src/leave-file/types/leave-file-undo-result.interface.ts`
- Modify:
  - `src/vacation-requests/services/vacation-requests.service.ts` (+ spec)
  - `src/users/services/users.service.ts`, `src/users/repositories/users.repository.ts`
  - `src/leave-file/services/leave-file-uploads.service.ts`

**Interfaces:**
- Consumes: Tasks 3, 4 and 9.
- Produces:
  - `ILeaveFileUndoResult = { kind: 'undone'; restored: number; kept: string[]; upload: ILeaveFileUpload } | { kind: 'closed'; reason: string }`. The reasons are `'it was already undone'` and ``it's been more than ${LEAVE_FILE_UNDO_DAYS} days``. Any applied upload of the workspace may be undone (D17), not only the latest.
  - `LeaveFileUndoService.undo(uploadId, user)` runs under `leaveFileLock`, and `LeaveFileUploadsService.undo` delegates to it.
    - **History:** `VacationRequestsService.deleteImported(requests: { id: string; updatedAt: string }[], uploadId: string, slackTeamId: string): Promise<string[]>` deletes, in one statement, each request still with that upload ID and that `updated_at`, and returns their IDs. A request still there but changed is kept and named `Anna Novak's annual leave May 4 – 15, 2026` (with `formatDateRange`). A request already deleted is neither restored nor kept.
    - **Balances:** `LeaveBalancesService.restoreMany` restores the balances. `UsersService.restoreContractStartDates(changes: { userId: string; expected: string; before: string | null }[], updatedBy): Promise<string[]>` sets each person's contract start back in one statement, only where it still is `expected`. Kept items are named `Anna Novak's balance` and `Anna Novak's contract start`.

- [ ] **Step 1:** Write failing unit tests with mocks: each closed reason; history → `deleteImported` with the undo's requests, with kept counted from IDs not returned but still present; balances → `restoreMany` and `restoreContractStartDates` with the undo's values, kept named.
- [ ] **Step 2:** Run `pnpm test src/leave-file/services/leave-file-undo.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm test src/leave-file src/users src/vacation-requests`. Expected: PASS.
- [ ] **Step 5:** Commit: `Undo a leave file where nothing changed since`.

### Task 11: Templates and where they start

**Files:**
- Create:
  - `src/leave-file/services/leave-file-template.service.ts` (+ spec)
  - `src/slack/leave-file/services/leave-file-dm.service.ts`, `src/slack/leave-file/leave-file-slack.module.ts`
  - `test/integration/support/leave-file.ts`, `test/integration/leave-file.int-spec.ts`
- Modify:
  - `src/slack/tabs/users/enums/users-tab-view-action-id.enum.ts`, `src/slack/tabs/users/views/users-tab.view.ts`, `src/slack/tabs/users/handlers/users-tab-action.handler.ts`, and the Users tab module
  - `src/slack/tabs/home/views/home-tab.view.ts`, `src/slack/tabs/home/handlers/home-tab-action.handler.ts`, `src/slack/tabs/home/services/setup-progress.service.ts`, `src/slack/tabs/home/types/setup-progress.interface.ts`, and the Home module
  - `src/team-setup/team-setup-workflow.service.ts`
  - `test/integration/first-setup.int-spec.ts`, `test/integration/users-tab.int-spec.ts`, `test/integration/round-trips.int-spec.ts`

**Interfaces:**
- Consumes: `LeaveFileUploadsService.hasApplied` (Task 9).
- Produces:
  - `LeaveFileTemplateService.balances(slackTeamId): Promise<string>`. It lists active people, sorted as the team template sorts them. The cells are `[name || email, email, contract_start_date?.slice(0, 10) ?? '', today (YYYY-MM-DD), '', '', '']`, under `BALANCES_HEADERS`, through `toCsv`/`csvText` (D24).
  - `LeaveFileTemplateService.history(): string`: `HISTORY_HEADERS` only (D25).
  - `LeaveFileDmService.sendTemplates(user)` makes two `DmFileService.send` calls:
    - `leave-balances.csv`, title `Leave balances`, with this intro;
    - `leave-history.csv`, title `Leave history`, intro `🗓 And the leave history: one row per leave, taken or agreed.`

    The first intro:

```
📥 *Bring in leave from your spreadsheet.* Two files, in any order: send each back to me here. Nothing changes until you check what it will do and press Apply.
• *leave-balances.csv*: each person's contract start and what they have left on the *Balance on* date, before any leave from that date on. Fill *Days left* or *Working days left*, whichever you count in, and *Bonus days left* if you have them. An empty cell keeps what is there.
• *leave-history.csv*: one row per leave: Email, Leave type (Annual leave, Bonus day, Sick leave, Unpaid leave or Other), From, To, and a Comment if you like. It arrives approved, and nobody is notified.
Set up a vacation policy and teams first: a balance needs a policy, and working days come from its holidays.
```

  - `UsersTabViewActionId.ImportLeave = 'import_leave'` replaces `ImportVacations`. The button `📥 Import leave` is shown to `ADMIN_AND_HR_ROLES`. The handler checks `ADMIN_AND_HR_ROLES` and runs `sendTemplates` in `runInBackground`. The `CsvImportInstructions` modal goes away here.
  - `ISetupProgress.hasLeaveImport: boolean`, read beside the others.
  - Home step, after `people` and before `projects`: `{ key: 'leave', optional: true, done: hasLeaveImport, title: 'Bring in leave balances', why: 'Balances and past leave from your spreadsheet, so everyone starts with the right number.', doneLabel: 'leave balances', buttons: [{ text: '📥 Import leave', actionId: UsersTabViewActionId.ImportLeave }] }`. The Home handler maps `ImportLeave` like `TeamFile`.
  - Welcome DM: a new line `4. *More → People → Import leave*: everyone's leave balances and past leave, from two files.`, and Projects becomes `5.`.

- [ ] **Step 1: Write failing tests.**
  - `leave-file-template.service.spec.ts`: the exact CSV lines for two people, one without a team, sorted last, with today `2026-06-17`.
  - `leave-file.int-spec.ts`:
    - `HR gets both templates from People`: `uploadedFiles` holds two files with those names, and their content is compared whole;
    - `an admin gets them from the checklist`;
    - `a manager clicking Import leave gets nothing`.
  - `first-setup.int-spec.ts`: the welcome DM lines.
  - `users-tab.int-spec.ts`: its Import vacations cases become Import leave cases.
- [ ] **Step 2:** Run `pnpm test src/leave-file && pnpm test:int test/integration/leave-file.int-spec.ts test/integration/first-setup.int-spec.ts test/integration/users-tab.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same commands and `pnpm test:int test/integration/access-control.int-spec.ts test/integration/round-trips.int-spec.ts`. Expected: PASS. Only the admin Home's `statements` rise, by the one `hasApplied` read.
- [ ] **Step 5:** Commit: `Send the leave file templates from People and Home`.

### Task 12: Previews, Apply, Cancel and Undo in Slack

**Files:**
- Create:
  - `src/slack/leave-file/enums/leave-file-message-action-id.enum.ts`
  - `src/slack/leave-file/views/leave-file-message.view.ts` (+ spec)
  - `src/slack/leave-file/services/leave-file-messages.service.ts`
  - `src/slack/leave-file/handlers/leave-file-message.handler.ts`
  - `src/slack/leave-file/leave-file-messages.module.ts`
  - `test/integration/leave-file-apply.int-spec.ts`, `leave-file-undo.int-spec.ts`, `leave-file-volume.int-spec.ts`
- Modify:
  - `src/slack/enums/integration-callback-id.enum.ts` (`LeaveFileMessage = 'leave_file_message'`)
  - `src/slack/services/file-upload.service.ts`, `src/slack/slack.module.ts`
  - `src/slack/tabs/vacation-requests/services/vacation-details-modal.service.ts`, `views/vacation-request-details-modal.view.ts`
  - `test/integration/leave-file.int-spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 6 and 9–11.
- Produces:
  - `LeaveFileMessageActionId { Apply = 'apply', Cancel = 'cancel', Undo = 'undo' }`. Values are `apply:<uploadId>:<digest>`, `cancel:<uploadId>` and `undo:<uploadId>`. Messages put the first action's `block_id` = `ViewCallbackId.LeaveFileMessage`, and the handler declares `allowedRoles: ADMIN_AND_HR_ROLES`.
  - **`FileUploadService`** handles a CSV or `.xlsx` shared in a DM:
    1. `readSpreadsheet`;
    2. `parseTeamFile` → the team flow;
    3. else `parseLeaveFile` → `LeaveFileUploadsService.receive`, then `LeaveFileMessagesService.postPreview`;
    4. else this ephemeral: `❗️ I can't tell what this file is. A team file needs Email and Team columns; leave balances need Email and Days left, Working days left, Bonus days left or Contract start; a leave history needs Email, Leave type, From and To.`
  - **Preview copy** (D8; everything a person typed goes through `escapeMrkdwn`):
    - **Balances:**
      - `*Here's what <file> will do*`, then `Balances on *Nov 12, 2026* for 31 people. Leave from that day on is taken from them as usual.` (with several dates: `Balances for 31 people, on the dates in the file.`);
      - `*Corrections (N)*: the file's balance differs from what Logbook counts`, then lines like `Anna Novak: 12 days left, Logbook counts 15 → correction -3` (working: `9 working days left, Logbook counts 7 → correction +2`; bonus: `2 bonus days left …`);
      - context `N people match what Logbook counts.`;
      - `*Vacation year changes (N)*: contract start set` with `Anna Novak: from Apr 15 (was Jan 1)`;
      - `*Planned leave (N)*: already in Logbook, from the balance date on`, with `Anna Novak: 12 left, 1 after Dec 21 – 31, 2026`;
      - `⚠️ *Rows it can't use (N)*` with `Row 7: <reason>`;
      - context `N rows change nothing.`
    - **History:**
      - `*Here's what <file> will do*`, then `Adds *52 leaves* for 21 people as approved. Nobody is asked to approve them and nobody gets a message.`;
      - a line by type (`38 annual leave, 2 bonus days, 8 sick leave, 4 unpaid leave`) and `6 of them are from today on`;
      - `*Balances that change (N)*: people with no balance from a file` with `Kate Moss: 24 → 14 days left`;
      - `*Planned leave (N)*: taken from a balance from a file` with the same lines as balances;
      - `*Already in Logbook (N)*: skipped`;
      - the unusable rows.
    - **Buttons:** Apply (primary) and Cancel.
    - **Result:**
      - balances: `✅ Set balances for N people.`, adding ` Changed the contract start of K.` and/or ` R rows weren't used.`, with buttons `Open People` (`NavigationActionId.People`) and `Undo`;
      - history: `✅ Added N leaves for M people.` (plus the unused rows), with `Open Time off` (`NavigationActionId.TimeOff`) and `Undo`;
      - `nothing`: `Nothing to change: everything in the file is already in Logbook.`;
      - `changed`: the new preview, as the team file does.
    - **Undo:** `↩️ Undone: N changes restored.`, plus `Kept, because they changed since: …` when some were kept; closed undo: ``This file can't be undone: <reason>.``
    - **Canceled and closed previews:** the team file's texts, reused or copied.
    - A long list keeps to Slack's limits with `…and N more`.
  - **Vacation details modal:** for a request with `leave_file_upload_id`, the `_No approval steps defined._` line becomes `Imported from <file> by <name> on <date>` (D23), through `LeaveFileUploadsService.findImport`.

- [ ] **Step 1: Write failing tests.**
  - `leave-file-message.view.spec.ts`: each preview section from a fixed plan, compared whole; `LEAVE_FILE_TYPE_NAMES` equals the `labels.ts` labels of each type; a list of 200 people stays within 50 blocks and 3000 characters per section.
  - Integration tests (support helpers `balancesCsv(...lines)`, `historyCsv(...lines)`, `shareLeaveFile(t, workspace, user, content, fileName)` and `clickInMessage` from `support/team-file.ts`). Each compares whole message texts and checks rows with `workspace.rows`:
    - **Balances preview:**
      - corrections, matches, vacation year changes and planned leave;
      - every unusable reason of Task 7 through a file;
      - nothing changes before Apply.
    - **Balances Apply:**
      - Home shows the file's number; next year (`travelTo('2027-03-01')`) carries over from it;
      - with history uploaded after it, leave before the date keeps the balance and changes the correction, and leave after the date is listed with what it leaves;
      - a second balances file with only Contract start filled moves the balance into the year that now holds its date: the preview lists the vacation year change, and Home shows the carryover from it (D30).
    - **History Apply:**
      - the requests are approved, with no `request_workflow_steps`;
      - no `chat.postMessage` to anyone but the uploader, and no time off offer;
      - the same file again adds nothing ("Nothing to change…");
      - a leave overlapping a request made in Logbook is unusable, and that request is unchanged;
      - the comment is kept;
      - future leave shows in Time off → "Who's off next";
      - the details modal says Imported from;
      - balances uploaded after it give the same balance.
    - **Round trips through spreadsheets:**
      - a balances template saved with US dates (`4/15/2021`, `11/12/2026`) and one with UK dates (`15/04/2021`, `12/11/2026`) both set contract start 2021-04-15 and Balance on Nov 12;
      - a `;` file with `12,5` sets 12.5;
      - an `.xlsx` with date cells (built with exceljs) reads them;
      - a file whose only slash date is `5/4/2026` gets the `ambiguousDate` reason.
    - **Changed before Apply:** a request made between preview and Apply gives a new preview, and Apply on it then works.
    - **Two clicks on Apply at once** (`Promise.all` of two `clickInMessage`): the requests are added once (Review Focus 5).
    - **Cancel:** the preview closes, and Apply on it then says it is closed.
    - **Undo:**
      - history Undo removes its requests and keeps one HR edited since, naming it;
      - balances Undo restores the earlier balance and contract start, and keeps one changed since;
      - Undo after 7 days (`travelTo`) says so;
      - Undo of an older upload works after a newer one.
    - **Access:** Admin and HR can upload and click; a Manager, Finance or Member who shares a file gets nothing, and their clicks on a preview's buttons are refused (`access-control.int-spec.ts` stays green).
    - **Setup:** the checklist's leave step shows until an upload is applied.
    - **Volume** (`leave-file-volume.int-spec.ts`, as in `team-file-volume.int-spec.ts`): Apply of 3000 history rows for 30 people sends the same number of statements as Apply of 300.
- [ ] **Step 2:** Run `pnpm test src/slack/leave-file && pnpm test:int test/integration/leave-file*.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the view, messages service (mirroring `TeamFileMessagesService`: preview as a message with its place stored, apply and undo after the answer through `runInBackground`, the upload's own message updated), handler, routing, callback ID and module.
- [ ] **Step 4:** Run the same commands and `pnpm test:int test/integration/team-file*.int-spec.ts test/integration/access-control.int-spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `Preview, apply and undo leave files in Slack`.

### Task 13: Remove the old vacations import and update the docs

**Files:**
- Delete:
  - `src/user-data-import/` (module and specs)
  - `src/slack/controllers/slack-admin-commands.controller.ts`
  - `src/slack-communication/services/slack-command-prompts.service.ts`
  - `test/integration/user-vacations-import.int-spec.ts`, `user-vacations-import-volume.int-spec.ts`
- Modify:
  - `src/app.module.ts`, `src/slack/slack.module.ts`, the slack-communication module
  - `src/slack/slack-handlers.registry.ts`, `src/slack/enums/integration-callback-id.enum.ts` (drop `CsvImportInstructions`)
  - `src/vacation-requests/services/vacation-requests.service.ts` (+ spec): drop `replaceVacations`, `replaceUserVacations`, `IVacationsReplacement`, and their interface entries. Keep `readHolidaysOfTeams` and `INSERT_CHUNK_ROWS`.
  - `src/slack/services/file-upload.service.ts`: drop `importers`, `VACATIONS_FILE` and the result message.
  - `slack-app-manifest.yml`: drop `/upload-vacations`.
  - Tests:
    - `test/integration/enterprise-grid.int-spec.ts`: probe the role per workspace with People → Import leave. An admin in the first workspace gets the two files; a member in the second gets none.
    - `test/integration/user-access.int-spec.ts`: drop "answers an admin command the same way".
    - `test/integration/time-off-logging.int-spec.ts`: drop "keeps the hours and drops the link on a CSV import".
    - `test/integration/team-file.int-spec.ts:428`: share `leave-balances.csv` in a channel instead.
  - `CLAUDE.md`:
    - the File imports bullet for `user-vacations.csv` becomes one for the leave files (recognized by columns, Admin and HR, preview/Apply/Undo, only adds, `leave_balances` as "N left on D");
    - "Vacation year and limits" names the file balance;
    - the `closeManyBeforeDelete` mention of the CSV import goes.

- [ ] **Step 1:** Remove the code and tests above, and rewrite the three integration tests.
- [ ] **Step 2:** Run `npx tsc --noEmit && pnpm lint && pnpm test && pnpm test:int test/integration/enterprise-grid.int-spec.ts test/integration/user-access.int-spec.ts test/integration/time-off-logging.int-spec.ts test/integration/team-file.int-spec.ts`. Expected: PASS, and `grep -rn "user-vacations\|upload-vacations\|replaceVacations" src test slack-app-manifest.yml CLAUDE.md` finds nothing.
- [ ] **Step 3:** Commit: `Remove the user-vacations.csv import`.

### Task 14: Full verification

- [ ] **Step 1:** Run `npx tsc --noEmit && pnpm lint && pnpm build`. Expected: no errors and no lint changes.
- [ ] **Step 2:** Run `pnpm test` and `pnpm test:int` (in the background; it takes minutes). Expected: all pass, and no `it.failing` added.
- [ ] **Step 3:** Check the spec's Testing section line by line against the tests written. Add any missing one to its task's spec file and commit it as `Test <what>`.
