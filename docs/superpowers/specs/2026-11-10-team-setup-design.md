# Setting up teams: company rules, a team file, and placing new people

Part 1 of moving a company into Logbook. Part 2 (leave balances and history) and part 3 (time from Harvest) get their own designs.

## Why

A company of a few dozen people moves to Logbook to automate leave, often leaving Harvest at the same time. When a company was set up by hand before, creating teams and putting people in them took the longest. HR knew the structure; someone else typed it in. Today:

- Every team carries its own second approval level, its decision notification recipients and its vacation policy. In a company where these are the same everywhere, eight teams mean picking the same HR people, leadership and office manager eight times.
- The only bulk tool, `user-team-mapping.csv` (`/user-team-mapping`, Admin only, `;`-separated, recognized by its file name), moves people into teams that already exist with exactly that name. It creates no teams and sets no approvers.
- People who join Slack later are added to Logbook (`team_join`, the daily member sync), but nobody is asked to place them. They stay without a team, and their requests go to HR.

The company we designed with works like this. Engineers are assigned to a client; each client team has a team lead. Time off is first agreed with the team lead. Then it goes to an address that reaches leadership, HR and the office manager. HR or leadership answers (either is enough), and the office manager prepares the documents. In Logbook terms:

| Today | Logbook |
|---|---|
| Team lead agrees | Level 1: the team's manager approvers |
| HR or leadership answers | Level 2: HR and leadership, rule ANY |
| Office manager prepares documents | Decision notification recipient |

Only level 1 differs between teams. The rest is the same for the whole company. A second office (e.g. in Poland) with its own leadership and policy is easy to imagine for another customer.

**Success:**
- HR set up the company without a developer: they set the company rules once, get a file that already lists everyone, fill in Team and Team lead, upload it, check the preview and apply it.
- Later, each new person is placed with one choice in a DM.

## Goals

1. **Company rules.** One place per workspace for:
   - the level 2 approvers and their rule;
   - who is notified of decisions;
   - the vacation policy.

   Every team follows them unless it opts out, and so does everyone in no team. A change applies to all of them at once (to requests made from then on; see decision 17).
2. **A team's own rules.** A team can stop following the company rules and hold its own values, which is what every team does today. Level 1 (manager approvers and their rule) always belongs to the team.
3. **The team file.** The bot sends Admin or HR a CSV listing every active person: Name and Email filled in, plus Team and Team lead as they are now. HR fill in Team and Team lead (`yes`) and upload the file to their conversation with Logbook.
4. **A preview before any change.** The preview shows:
   - the teams it will create with their leads and number of people;
   - who it moves from one team to another;
   - who stays without a team;
   - people who get the Manager role because they lead a team;
   - teams with no lead (their requests go straight to level 2);
   - team names it matched to existing ones;
   - every row it can't use, with the reason;
   - a line saying new teams follow the company rules, with a link to change them.

   Buttons: Apply, Cancel.
5. **Apply** creates the missing teams (following the company rules), sets members and leads, and answers with the result and an **Undo** button.
6. **Uploading again works as a sync.** The file is the truth for the people in it: an empty Team takes a person out of their team, and a removed `yes` removes them as lead. Teams that aren't in the file are left alone.
7. **New people.** When someone new joins the workspace, everyone with the HR role (the admins when nobody has it) gets a DM: "<Name> joined Slack. Which team is <Name> on?", with a team select and **Not yet**.
   - The first answer wins, and the others' messages update to say who placed the person where.
   - A person placed some other way (team form, People, the file) also updates the open messages.
8. **The checklist and the welcome DM follow the new order:**
   1. a policy;
   2. company rules;
   3. teams from the file;
   4. everyone in a team;
   5. projects (optional).
9. **Admin and HR** can do all of this. Today the file import is Admin only.

## Non-goals

- Named rule groups shared by several teams (an "office"). They will come later, and the model must allow adding them without reworking teams (see Decisions).
- Building teams from Slack user groups, channels or an HRIS. No comparable product does it, and this customer's structure lives with HR.
- Leave balances and history, and time from Harvest: parts 2 and 3.
- Deleting teams, or changing roles other than making a lead a Manager, through the file.
- Tasks under projects: decided against for the whole migration.

## Anti-goals (would be a failure even if it works)

- **Anything changing before Apply.**
- **Losing a row silently.** Every row the import can't use is in the preview with its reason.
- **Apply doing something other than what the preview showed.** If the workspace changed in between, the bot shows a new preview instead.
- **A level 1 approver who may not approve.** Leads need the Manager or Admin role.
- **A flood of DMs to HR at install.** The first member import must not count as new people joining.
- **Removing approvers HR didn't see in the file.** A manager approver who isn't a member of the team is not in that team's rows and must stay.
- **A file that only a developer can produce.** No numbered columns, no exact file name, no fixed separator.

## Constraints

**Teams today**
- `teams` holds:
  - `manager_approvers` and `hr_approvers`: Slack user IDs, each list with its rule (`ANY`/`ALL`);
  - `approval_notification_recipients`;
  - `vacation_policy_id`: a required choice in the form since recently, where "No Policy" is a valid answer.
- `(name, slack_team_id)` is unique, and `MAX_TEAMS_PER_SLACK_TEAM` caps the count.
- A person is in at most one team (`users.team_id`).
- Level 1 approvers need the Manager or Admin role and level 2 the HR or Admin role (the team form's hints).
- A manager sees the teams that list them as a manager approver (`TeamsService.findManagedTeamIds`).

**Where the team-level rules are read.** All of these must read the effective rules (company or own) from one resolver in the `teams` domain module, not each on its own:
- `VacationRequestProcessingService` (levels, and the fallback to HR or admins);
- `VacationDecisionNotificationsService` (recipients);
- `VacationUsageService` and `VacationPeriodUsageService` (policy limits);
- the holidays services (a policy's holidays);
- `TimeOffLoggingService`;
- `UserUpdateValidatorService`;
- the Policies tab;
- `SetupProgressService`;
- the Teams tab and form.

`TimeEntryApprovalsService` uses level 1 only and is unchanged.

**People in no team today:**
- They have no policy limits (`VacationUsageService.getVacationPolicyIfExists`) and no notification recipients.
- Their requests go as one `ANY` level to everyone with the HR role, else to the admins (`VacationRequestProcessingService.startWorkflow`).
- A workflow stores its approvers when it starts, so editing a team's approvers doesn't touch requests already waiting. Recipients and policy limits are read when they are needed.

**Files**
- `file_shared` runs as a job (`SlackEventsService`).
- `FileUploadService` routes by file name, refuses files over 1 MB and answers ephemerally.
- The handler checks the Admin role today.
- The Messages tab is enabled, so a file dropped in the conversation with Logbook arrives.
- Files go out through `DmFileService` (`files:write`). CSVs are written with `src/common/utils/csv.utils.ts` (byte order mark, CRLF, formula escaping).

**New people** come from three places:
- `team_join` (`SlackEventsService.handleUserJoin`);
- the daily member sync;
- the install's member import (`TeamSetupWorkflowService`, `TeamUsersSyncService`).

**Messages with buttons**
- The first action's `block_id` is a `ViewCallbackId`.
- Every handler declares `allowedRoles`.
- IDs from the client (team, person) are checked to be the workspace's.
- Slack limits a message to 50 blocks and a section to 3000 characters.

**Conventions** in `CLAUDE.md`:
- domain code doesn't import `src/slack`;
- multi-row writes are transactions in services;
- slow work runs after the answer (`runInBackground` or a job);
- schema changes are migrations with `pnpm db:types`;
- new functions revoke `PUBLIC` execute;
- every flow gets integration tests, including what each role may not do.

**Deployment:** Logbook isn't deployed anywhere yet (November 2026), so existing data needs no compatibility steps beyond a correct migration.

## Decisions made with the user

1. **What a team is.** Teams are per client; one or more team leads approve first. HR and leadership approve second, and either is enough. The office manager is notified of decisions.
2. **File layout: one sheet.** Columns are Name, Email, Team, Team lead. A lead is a member of their team, and a team may have several leads. (Rejected: two sheets, People and Teams. It would allow a lead outside the team, but needs Excel instead of CSV.)
3. **Flow:**
   1. Upload.
   2. Preview with Apply and Cancel.
   3. Result with Undo.
   4. Later, a DM to HR for each new person.
4. **Uploading again is a sync**; teams not in the file are not deleted.
5. **Company rules apply live** to every team that follows them. A team can have its own. Named groups of rules come later.
6. **Who and what file:** Admin and HR may upload. CSV and Excel are accepted, and the file is recognized by its columns, not its name.

## Decisions I made (please check)

1. **Level 1 rule** for teams created from the file: `ANY`.
2. **Leads and roles.**
   - A `yes` on a Member makes them a Manager, and the preview says so. Admins and Managers keep their role.
   - A `yes` on someone with the HR or Finance role is an unusable row: those roles can't approve at level 1.
   - Removing a `yes` never takes a role away.
3. **Manager approvers who aren't members** of a team (set in the form) are kept. The file controls the lead marks of members only.
4. **Team names match ignoring case and repeated spaces**, against existing teams and within the file. The preview shows each match, e.g. `acme  corp → Acme Corp`; there is no per-conflict question.
5. **Unusable rows don't block Apply**; the other rows are applied.
6. **Apply plans again** from the stored rows against the current state. If the result differs from the preview, the bot posts a new preview instead of applying.
7. **Undo**
   - It works for the workspace's latest applied upload, for 7 days.
   - It restores what that upload changed (membership, leads, roles granted) wherever the value is still what the upload set. Anything changed since is left alone and listed.
   - Teams the upload created are deleted if they are empty after that.
8. **Formats.**
   - The template is a CSV: comma-separated, UTF-8 with a byte order mark.
   - The upload is a CSV (comma or semicolon) or an `.xlsx` (first sheet).
   - It is recognized by a header row with `Email` and `Team`. Headers are matched ignoring case; Name is informational.
9. **Who is in the template.**
   - Active people only, sorted by team, then name; people without a team come last.
   - On upload, a person whose row was deleted is left unchanged.
   - An email not in the workspace, or deactivated, is an unusable row.
10. **Messages to HR about new people**
    - Only for people added after the workspace's install import has finished.
    - **Not yet** closes the question for everyone. The person then counts in the checklist's "people without a team".
11. **Storing company rules.**
    - A rule set table with one default set per workspace now.
    - A team either points at a set or holds its own values.
    - Named sets later are more rows in that table. The builder may choose another model if adding named sets later doesn't change how teams store their rules again.
12. **The new file replaces `user-team-mapping.csv`**, its parser, service and `/user-team-mapping`. `/upload-vacations` stays until part 2.
13. **Where it starts.** A "Set up teams from a file" button on Teams and on the checklist step sends the template by DM. The company rules are edited from Teams (a "Company rules" button opening a modal) and from the preview's link.
14. **People in no team follow the company rules.** This matches the user's process, where every request goes to the same HR, leadership and office manager address.
    - The company policy's limits apply to them.
    - Their request goes to the company's level 2 approvers with its rule, and its decision goes to the company's recipients.
    - While the company rules name no level 2 approvers, today's fallback stays: everyone with the HR role, else the admins. The resolver therefore takes a person (their team, or none), not a team.
15. **A lead the file moves out of a team stops leading it.** Someone who was a member and a manager approver of team A, and whom the file puts in another team or in none, is removed from A's manager approvers. HR saw that row, so this is not an approver they didn't see. The preview lists it ("Anna Novak no longer leads Acme Corp"), and Undo restores it. Manager approvers who weren't members of A before the upload stay (decision 3).
16. **Checklist steps:**

    | Step | Done when |
    |---|---|
    | A policy | One exists (as today) |
    | Company rules | They name at least one level 2 approver, or every team has its own rules |
    | Teams | At least one team has a level 1 or level 2 approver (as today, however the teams were made) |
    | Everyone in a team | Nobody active is left without a team (as today) |

    The checklist disappears when all four are done. The file is the suggested way to finish "Teams", not a condition.
17. **Live means new requests.** A change to the company rules, or a team switching between company rules and its own, takes effect for requests made from then on, as editing a team does today. Requests already waiting keep the approvers their workflow started with. Recipients and policy limits are read when needed, so they follow the change at once.

## Left to the builder

- Table and column names, and the migration.
- How the effective-rules resolver is shaped.
- The `.xlsx` library: it must work under CommonJS and go in `dependencies`.
- How the uploaded rows are stored between preview and Apply (with an expiry), and what Undo records.
- The exact Block Kit of the preview, the result and the new-person DM within Slack's limits: long lists shortened with "…and N more", as `FileUploadService` does now.
- How the Teams tab and form show "Follows company rules" and switch a team to its own rules.
- All copy.

## Testing

Integration tests (`test/integration`, `SlackTestClient`, `FakeSlackApiClient`, `uploadFile`/`uploadedFiles`) for:
- **Template:** asking for it sends a CSV with every active person and the current teams and leads.
- **Preview:** a filled file gives a preview that matches the file, and nothing in the database changes until Apply.
- **Apply:** creates teams that follow the company rules, sets members and leads, and makes a Member lead a Manager.
- **Unusable rows:** an unknown email, an HR person as lead, a `yes` without a team, too many teams. Each is listed, and the rest is applied.
- **Name matching:** names that differ only in case or spaces match the existing team.
- **Re-upload:** an empty Team removes a person, a removed `yes` removes a lead, teams not in the file stay, and non-member manager approvers stay.
- **Changed before Apply:** a change made between preview and Apply leads to a new preview.
- **Undo:** restores the previous state, and keeps a change made by hand after the upload.
- **Access:** HR and Admin can do all of it; Manager, Finance and Member can do none of it (`access-control.int-spec.ts`).
- **Company rules:**
  - Changing them changes the levels, notifications and policy limits of a new request in a team that follows them, and of a new request by someone in no team.
  - A request already waiting keeps its approvers.
  - A team with its own rules is unaffected.
  - With no level 2 approvers in the company rules, a teamless person's request still goes to HR, else the admins.
- **Lead moved out by the file:** they are removed from their old team's approvers, and Undo puts them back.
- **New person:** a `team_join` sends HR the DM, the first choice places the person, and the other messages update. The install import sends no such DMs.
