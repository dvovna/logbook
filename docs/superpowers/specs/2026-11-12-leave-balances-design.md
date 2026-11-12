# Leave balances and history from a file

Part 2 of moving a company into Logbook. Part 1 (teams, company rules, the team file; released in 0.3.0) is `2026-11-10-team-setup-design.md`. Part 3 (time from Harvest) gets its own design.

## Why

A company that moves into Logbook in the middle of a year already has leave taken this year, days carried over from last year and leave agreed for the months ahead. Today Logbook knows none of it:

- **Balance.** A balance is counted only from requests in Logbook (`VacationPeriodUsageService`), plus a carryover HR enters by hand, one person at a time, on the profile (`users.carryover_days`, which counts only for the year the person came into Logbook). Someone who took 15 days from January to October sees their full allowance on day one.
- **The old import.** The only bulk tool, `user-vacations.csv` (`/upload-vacations`, Admin only), has several problems:
  - The file is recognized by its name, is `;`-separated and uses numbered columns `vacation[0].startDate`…
  - It sets the contract start and **replaces every vacation of the person**. After the move this would delete requests people made in Logbook.
  - It has no notion of a balance.
  - It refuses the whole file over one bad line (`AbstractCsvParser`).
  - It has no preview and no Undo.
- **Every company's spreadsheet is different.** We don't know what a company's spreadsheet looks like, and the format must suit any company. HR may only have totals rather than the dates of each leave. Where dates exist, they are records the company keeps, and Logbook should hold them as leave, not only as a number.

**Success:**
- On the day of the move, each person's balance on Home is the number HR gave, less any leave from its date on, which both previews show.
- The leave HR has with dates is in Logbook as approved leave.
- HR does it without a developer, from templates the bot sends, with a preview, Apply and Undo, as with the team file.
- People don't request again leave that was already agreed, and approvers see it in "who's off".

## Goals

1. **Two templates in one DM.** The bot sends Admin or HR both files with a short how-to:
   - `leave-balances.csv`, one row per active person: Name, Email, Contract start, Balance on, Days left, Working days left, Bonus days left.
   - `leave-history.csv`, one row per leave: Name, Email, Leave type, From, To, Comment.
2. **A preview before any change.** HR uploads either file, in any order, to their conversation with Logbook and gets a preview with Apply and Cancel. Apply answers with the result and Undo.
3. **A balance wins over dates.** A balance HR gives is what the person has left on the "Balance on" date. Leave in Logbook from that date on is taken from it; leave before it is history.
4. **Visible corrections.** When the balance differs from what Logbook counts from the allowance, the carryover and the leave before the date, the difference is a visible correction. The person sees it next to their balance and HR sees it in the person's balance. The preview shows each one.
5. **Dated leave arrives approved.** No approval workflow, no messages, no time logged for it.
6. **The history file only adds.** Leave already in Logbook with the same type and dates is skipped, leave that overlaps other leave can't be used, and nothing is deleted or changed. Undo removes an upload's leave for 7 days.
7. **Where it starts.** People → "📥 Import leave" (replacing "📥 Import vacations (CSV)") sends the templates. Home's checklist gets an optional step "Leave balances" after "Everyone in a team", and the welcome DM mentions it.
8. **The old import is removed:** `/upload-vacations`, the `user-vacations.csv` format, `src/user-data-import`.

## Non-goals

- Changing a balance by hand later (an adjustment form). Corrections come only from the balances file. A form may come later.
- Half-day requests. Requests stay in whole days; only a balance in the file may be a half (12.5).
- Pending leave in the file, or approval workflows started from it: not-yet-agreed leave is requested in Logbook as usual.
- Logging imported leave as time. Imported leave gets no "Log time off" offer, as a CSV import offers nothing today.
- People who are not in the workspace or are deactivated, former employees included.
- Changing or deleting leave already in Logbook through a file (a sync).
- Carryover that expires, accrual by month, and other policy features.
- A leave report in Reports.
- Time from Harvest (part 3).

## Anti-goals (would be a failure even if it works)

- **Anything changing before Apply.**
- **Losing a row silently.** Every row the import can't use is in the preview with its reason.
- **Apply doing something other than what the preview showed.** If the workspace changed in between, the bot shows a new preview instead (as the team file does).
- **A file touching what people did in Logbook.** The history file never changes or deletes a request. Undo removes only what that upload added, and only while it is still as added.
- **Imported leave pinging anyone**: approvers, the person, notification recipients.
- **A balance on Home that differs from the allowance arithmetic with no visible reason.**
- **A balance that depends on which file was uploaded first.**
- **A file that only a developer can produce.** No numbered columns, no exact file name, no fixed separator.

## Constraints

**How a balance works today** (`VacationsUsageService`, `VacationPeriodUsageService`)
- The vacation year runs from the contract start anniversary, or over the calendar year when there is none (`vacation-period.utils.ts`).
- Limits come from the vacation policy the person's team follows (`TeamRulesService.forTeam`; the company rules' for a team that follows them and for someone in no team). With no policy, `limits` is null: usage is tracked, nothing is checked, and there is no balance.
- Annual leave has two limits at once, "26 calendar days, at most 20 of them working days" (`vacation_days`, `working_days`); both are checked. Bonus days are counted in working days. Sick, unpaid and other leave are only counted.
- Usage is counted from approved and pending requests on every read. Their working days come from the current holidays of the policy each request's team follows (`requests.team_id`).
- Carryover:
  - in the year the person came into Logbook (`users.created_at`, `getJoinedVacationPeriod`), it is what HR entered (`users.carryover_days`, at most the policy's `carryover_days`, `MAX_POLICY_DAYS` = 60);
  - in each later year, what was left of the year before, up to the policy's most;
  - a future year has none.

  Calendar and working days are counted apart (`carryoverInto`).
- A request is checked against every vacation year it touches (`VacationRequestsValidationService.checkDaysRequested`).
- **Where the balance is shown:**
  - Home ("N available / M total", "+K carryover", bonus days);
  - People → a person's usage (`user-vacation-usage-modal.view.ts`);
  - the edit-user modal (the carryover field).

**Requests**
- A person's active requests may not overlap (`validateNoOverlap`, `ACTIVE_REQUEST_STATUSES`).
- `vacation_requests` stores `days` and `working_days` as they were when it was made, plus `team_id`, `user_comment`, `created_by` and `status`.
- HR and admins edit and delete requests through `TimeOffChangesService` (the request's lock, linked time).
- `VacationRequestsService.replaceVacations` writes many people's vacations in one transaction and a few statements (`user-vacations-import-volume.int-spec.ts` counts them). The new import should keep that property.
- Approved leave appears in "Who's off next", in the teammates-off context of approvers' DMs (`TimeOffContextService`), and in All requests.

**Files** (built in part 1, `src/team-file`, `src/slack/team-file`, `src/slack/services/file-upload.service.ts`)
- `file_shared` runs as a job. `FileUploadService` refuses files over 1 MB, takes CSV and `.xlsx` shared in the sharer's DM with the bot, and recognizes a team file by its columns (Email and Team). Today it answers any other CSV with "This doesn't look like a team file". The vacations file is routed by its name and is Admin only.
- `parseTeamFile`:
  - reads CSV with `,` or `;`, and refuses a CSV that isn't UTF-8 with a message saying how to save it;
  - reads the first sheet of an `.xlsx` (exceljs);
  - matches headers ignoring case and spaces.
- `team_file_uploads` keeps the parsed rows between the preview and Apply (7 days), a digest of the plan shown, a status, the preview message's `ts` and what Apply changed for Undo.
- Apply re-plans under a workspace lock and applies only when the digest matches the clicked preview. Undo restores, for 7 days, only what is still as Apply left it.
- Templates go out through `DmFileService` (`files:write`), written with `csv.utils.ts` (byte order mark, CRLF, formula escaping).

**Conventions** (`CLAUDE.md`)
- Domain code doesn't import `src/slack`.
- Multi-row writes are transactions in services, with locks in rank order.
- Slow work runs after the answer.
- Schema changes are migrations plus `pnpm db:types`.
- Every handler declares `allowedRoles`, and IDs from the client are checked to belong to the workspace.
- Text people typed goes through `escapeMrkdwn`.
- Slack allows 50 blocks per message and 3000 characters per section.
- Every flow gets integration tests, including what each role may not do.

**Deployment:** Logbook isn't deployed anywhere yet (November 2026), so existing data needs no compatibility steps beyond a correct migration.

## Decisions made with the user

1. **Our own format.** The bot sends templates; Logbook does not adapt to a company's spreadsheet. The user doesn't know what a typical one looks like and wants it to suit any company.
2. **What HR brings:**
   - the contract start (it sets the vacation year);
   - the balance on a date;
   - dated leave: what was taken this year and what is agreed ahead.

   Older years are welcome as history.
3. **Both a balance and dates.** HR may have only totals, and where dates exist they are records to keep.
   - The balance wins: it is the number people already know, and it may include things no date shows (days added by hand, time off for overtime, half days).
   - The difference becomes a visible correction rather than a hidden one, as HR systems do it.
   - A mismatch doesn't block Apply: HR would otherwise have to invent leave to make the numbers agree.
   - With no balance there is no correction, and the dates decide.
4. **Two CSV files, balances and history** (option B of three; rejected: one CSV mixing person rows and leave rows, and one Excel workbook with two sheets). Either may be uploaded alone.
5. **Imported leave is approved**, starts no workflow, sends no message and logs no time.
6. **Uploading again:**
   - The history file only adds. Leave already in Logbook with the same person, type and dates is skipped; leave overlapping another of the person's active requests (or an earlier row of the file) is an unusable row. Nothing is deleted.
   - A wrongly imported leave is fixed in Logbook like any request, or the whole upload is undone and a fixed file uploaded.
   - In the balances file the latest upload replaces a person's balance.

   Rejected: the history file as a sync of earlier imports. It would make the file a second source of truth beside Logbook, and a row deleted by mistake would delete approved leave, possibly with logged or billed time.
7. **Two balance columns, calendar and working days.** HR fills the one the company counts in. An empty one gets no correction, and there the dates decide. Bonus days have their own column.
8. **The previews** (agreed on a mockup):
   - **Balances:**
     - the "Balance on" date and how many people;
     - corrections, each with the file's number and Logbook's count;
     - how many match;
     - vacation year changes from a contract start;
     - "Planned leave": requests already in Logbook from the balance date on, with the balance after them, so HR notices a number that already subtracted them;
     - unusable rows.
   - **History:**
     - how many leaves for how many people, by type, and how many are from today on;
     - the balances that change, for people with no balance from a file;
     - for people with a balance from a file, the leave it adds from the balance date on, each with the balance it leaves (the same lines as "Planned leave"). Their leave before the date changes only their correction.
     - how many are already in Logbook and skipped;
     - unusable rows.
   - **The result:** "Added N leaves for M people", with Open Time off and Undo.
9. **A person with no vacation policy** has no balance to set. Their balance is an unusable row that says to set a policy first.
10. **Where it starts and who:**
    - People → "📥 Import leave" sends both templates and a how-to.
    - Home's checklist gets an optional step "Leave balances" after "Everyone in a team" (like Projects; it doesn't keep the checklist open), and the welcome DM mentions it.
    - Admin and HR may do all of it.
    - `/upload-vacations` and `user-vacations.csv` go away.

### My calls, played back and confirmed

11. **A balance is "N left on date D"**, stored as such and applied on every read, not a correction frozen at Apply. The available days of that vacation year are N minus the leave in Logbook from D on (approved and pending, as usage counts today), whatever was imported before D, earlier or later. This is what makes the order of the two uploads not matter. Days of a request across D count from D. N is therefore what was left before any leave from D on: the template's how-to says so, and both previews list that leave with the balance it leaves, so a number that already subtracted booked leave shows up as counted twice.
12. **The "Balance on" date** must fall in the person's current vacation year (with the contract start from the same row) and not after today. The template fills it with the day it was sent, and an empty cell means the day of the upload.
13. **Numbers:**
    - Whole and half days are accepted (12, 12.5).
    - A negative balance is accepted; Home shows 0 available, as it does today for an overspent balance.
    - Anything else is an unusable row with its reason.
14. **An empty cell changes nothing**: neither the contract start nor any balance. There is no way to clear a balance from a file other than Undo.
15. **Dates and numbers survive a round trip through Excel or Google Sheets.** *(Changed with the user after the builder check: the earlier "refuse every slash date" would have made every row of a template that HR opened and saved again in a US or UK spreadsheet unusable, since Contract start and Balance on come filled in.)* The templates stay CSV.
    - **Accepted dates:** `2026-05-04`, `04.05.2026`, Excel date cells, and slash dates (`05/04/2026`, `5/4/26`).
    - **Slash dates are read per file.**
      - If any slash date in the file has a first part over 12, every slash date is day/month.
      - If any has a second part over 12, every one is month/day.
      - If both happen, the file is inconsistent. If neither happens, the file is ambiguous. In both cases each row with a slash date is unusable, with a reason that says to write dates as `2026-11-12` or to save the file as Excel.
    - **Numbers:** a decimal comma is accepted (`12,5`), as European spreadsheets write it with `;` between cells.
16. **Imported leave isn't checked against the limits**: it was taken or agreed already. The balances preview and the history preview show the balance it leaves.
17. **Undo** works on any applied upload for 7 days, not only the latest. It restores only what is still as that upload left it:
    - for the history file, it deletes each added leave that is unchanged since;
    - for the balances file, it restores each person's earlier balance (or none) and contract start.

    What changed since is left alone and listed.
18. **Order of setup:** policy and teams before leave, as the checklist and the how-to say. Without a policy there is no balance, and a leave's working days come from the holidays of the policy its team follows.
19. **The profile's carryover has no effect on a year that has a balance from a file** (the balance already includes it). The edit-user modal says so for that year, so an edit there isn't silently ignored.

## Calls I made while writing (please check)

20. **Comment column.** The history file has an optional Comment column, which goes into the request's comment (`user_comment`). It is meant for records like "agreed by email with the CEO".
21. **Leave types** are Logbook's labels (Annual leave, Bonus day, Sick leave, Unpaid leave, Other) matched ignoring case and spaces, plus the internal values (`annual_leave`…). No synonyms: "Holiday" or "Vacation" could mean several things, and a wrong guess would count against the balance silently. The reason for such a row names the accepted types.
22. **An imported leave belongs to the person's current team** (`team_id`), as the old import did, so its working days come from that team's policy holidays.
23. **An imported leave is marked as imported**: who applied it, from which upload. Its details show "Imported from leave-history.csv by Anna on Nov 12" instead of an empty approval timeline.
24. **The balances template:**
    - lists active people, sorted as the team template (by team, then name);
    - fills in Contract start as it is now and Balance on with today;
    - leaves the three balance columns empty. A number prefilled from Logbook's count and left untouched would freeze that balance as if HR had confirmed it.
25. **The history template** is the header only, with no example row that might be uploaded by mistake.
26. **A person on two rows of the balances file**: the second row is unusable ("Anna Novak is already on row 5"). The import doesn't pick one.
27. **What applies from a row with a problem.** A row's contract start applies even when its balance can't, e.g. for a person with no policy. Each unusable part is listed.
28. **Recognizing the files:**
    - **balances:** Email and at least one of Contract start, Days left, Working days left, Bonus days left, and no Team column;
    - **history:** Email, Leave type, From and To;
    - **team file:** Email and Team, unchanged.

    A CSV or `.xlsx` that is none of them gets one message naming the three kinds and their columns, replacing "doesn't look like a team file".
29. **The checklist step "Leave balances"** counts as done once any leave upload (balances or history) was applied in the workspace. It stays optional.
30. **A balance belongs to its date D, not to a year.** A later change of the contract start, in the edit-user modal or by a balances file with only Contract start filled, moves the year boundaries, and the balance then counts in whichever year now holds D. When that is the year before the current one, the balance carries over into the current year, up to the policy's most, as what was left of that year. The preview's "vacation year changes" and the edit-user modal say so for the people concerned. HR who corrects a wrong contract start most likely gave the balance for the real year anyway, so it is kept and not dropped.

## Left to the builder

- Tables, columns and the migration:
  - where a person's balance on a date is kept (per person and vacation year, with the upload that set it);
  - how uploads are stored (a generalized `team_file_uploads` or a table of its own);
  - how an imported request is marked.
- How the stored balance enters `VacationsUsageService` and `carryoverInto`. The year after a year with a file balance carries over from it, and years before it no longer matter for the years after it.
- Modules. A domain module for the leave file, with the Slack side next to `src/slack/team-file`, sharing the CSV/Excel reading of `parseTeamFile` rather than copying it.
- The exact Block Kit and copy of the how-to DM, the previews, the result and the correction lines, within Slack's limits; long lists end with "…and N more".
- Where exactly a correction shows. At least:
  - Home, next to the balance;
  - People → the person's usage;
  - the person's Time off history, as one line.
- Row limits per file, the per-person cap on leaves, and sanity bounds on dates (e.g. a leave years ahead), each refused as an unusable row with its reason.
- Keeping the history Apply at a few statements however many rows, as `replaceVacations` does now.

## Testing

The user asked for everything to be covered by tests. Every rule in this document has one:
- unit specs for the parser (each date and number format, the per-file slash rule with its day/month, month/day, inconsistent and ambiguous cases, headers, CSV and `.xlsx`);
- unit specs for the planners (every unusable reason, duplicates, overlaps, corrections, planned leave);
- unit specs for the balance arithmetic (a balance on a date, units, halves, negatives, carryover from it, a moved contract start);
- integration tests for the flows below.

A round trip is tested with the files a spreadsheet writes back: a template saved with US dates, with UK dates, and with `;` and decimal commas.

Integration tests (`test/integration`, `SlackTestClient`, `FakeSlackApiClient`, `uploadFile`/`uploadedFiles`), replacing `user-vacations-import*.int-spec.ts`:

- **Templates.** "Import leave" sends both files. The balances one lists every active person with their contract start and today's date and has empty balance columns; the history one has only the header.
- **Balances preview:**
  - it lists corrections, matches, vacation year changes, planned leave, and unusable rows: an unknown email, a deactivated person, no policy, not a number, a date outside the current vacation year or in the future, a second row of a person;
  - nothing in the database changes until Apply.
- **Balances apply:**
  - Home shows exactly the file's number on its date;
  - a request in Logbook after the date takes from it, and one before the date doesn't;
  - working days only, bonus days, a half day, and a negative balance shown as 0;
  - a request above the balance is refused;
  - next year's carryover comes from the file's balance (with `travelTo`);
  - the profile's carryover doesn't move a year with a file balance.
- **Order doesn't matter.** History after balances:
  - leave before the balance date leaves the balance as it was and changes the correction;
  - leave from the date on is taken from the balance and listed in the history preview with the balance it leaves.

  Balances after history give the same balance.
- **A contract start changed later** moves a file balance into the year that now holds its date; across the anniversary it carries over.
- **History preview and apply:**
  - the leaves are approved with no workflow steps;
  - no `chat.postMessage` goes to anyone, and no time off offer is made;
  - counts by type;
  - Excel date cells, `04.05.2026` and slash dates read by the per-file rule; a file whose slash dates are all ambiguous gets unusable rows with the reason;
  - an unknown type is refused;
  - the comment is kept;
  - future leave shows in "Who's off next" and in an approver's teammates-off context.
- **Duplicates and overlaps.** The same file twice adds nothing the second time. A leave overlapping a request made in Logbook, or another row, is unusable, and the request is untouched.
- **Changed before Apply.** A change between the preview and Apply leads to a new preview.
- **Undo:**
  - a history upload's Undo removes its leaves and keeps one HR edited since, naming it;
  - a balances upload's Undo restores the earlier balance and contract start and keeps one changed since.
- **Access.** Admin and HR can do all of it; Manager, Finance and Member can do none of it (`access-control.int-spec.ts`).
- **Volume.** A history file of a few thousand rows applies in the same few statements as a small one.
- **Setup.** The checklist shows the optional step until an upload is applied; the welcome DM mentions it; `/upload-vacations` is gone.
