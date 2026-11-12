# Team Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR and admins set up a workspace's teams without a developer:
- company rules that every team and every person without a team follow;
- a team file the bot sends out and takes back, with a preview, Apply and Undo;
- a DM to HR that places each new person.

**Architecture:**
- **Company rules** are a rule set row per workspace, in the `teams` domain module. One resolver, `TeamRulesService.forTeam`, gives every reader the rules that apply: the company's or the team's own.
- **The team file** is a new domain module, `src/team-file`. It parses the file, plans the changes (a pure function), and stores the upload so it can be applied and undone. The Slack side (`src/slack/team-file`) sends the template, posts the preview and result messages, and handles their buttons.
- **New people** get a job that DMs HR. Whoever places the person, by any route, closes the prompt through a domain event.

**Tech Stack:** NestJS 11, TypeScript, Kysely 0.28 on Postgres (Supabase migrations), pg-boss jobs, Slack Block Kit, `csv-parse`, `exceljs` (new), Jest (unit and integration).

**Spec:** `docs/superpowers/specs/2026-11-10-team-setup-design.md`. Its numbered "Decisions I made" are referred to below as D1–D17.

## Global Constraints

**Conventions**
- Follow `CLAUDE.md`:
  - interfaces start with `I`;
  - every class member has explicit accessibility;
  - imports use `@modules/…`/`@common/…`, never relative `../`;
  - domain code (`src/teams`, `src/team-file`, `src/users`) never imports `src/slack`;
  - services use `TransactionService`, never `DatabaseService`.
- Text people typed goes into mrkdwn through `escapeMrkdwn`: team names from the file and from forms, and people's names.
- Bot copy is English. Write it exactly where this plan gives it; elsewhere write short plain sentences in the style of the existing messages.

**Roles**
- The team file, company rules and new-person prompts: `ADMIN_AND_HR_ROLES`.
- `user-vacations.csv` stays Admin only.

**Limits**
- Upload: 1 MB (`MAX_IMPORT_FILE_BYTES`), 1000 data rows.
- Messages: at most 50 blocks, section text at most 3000 characters. Lists show 10 items, then `…and N more`.
- Preview: can be applied for 7 days after posting.
- Undo: available for 7 days after Apply, and only for the workspace's latest applied upload.

**Schema**
- Migration timestamps come after `20261111100000`.
- After each migration run `pnpm db:init && pnpm db:types`, and commit `src/common/types/database.types.ts`.
- New tables need nothing extra (RLS is on, API roles have no grants). This plan adds no SQL functions.

**Dependency:** `exceljs@^4.4.0` in `dependencies`. It is CommonJS; don't use an ESM-only reader.

**Commits:** short imperative one-line messages in the repository's style (e.g. "Add company rules that teams follow"), with no trailers.

**Before every commit:** `npx tsc --noEmit`, `pnpm lint`, and the task's tests pass.

## Review Focus

1. **A file Excel saved in a European locale:** `;` separators, a byte order mark, CRLF. It is read like a comma CSV (test in Task 6).
2. **Emails typed differently:** ` Anna@Company.io ` matches `anna@company.io` (test in Task 7).
3. **The same email on two rows:** the second row is unusable ("already on row N"), not a silent last-row-wins (test in Task 7).
4. **Apply clicked on an older preview** after a newer upload: it says it was replaced by the newer file and changes nothing (test in Task 9).
5. **Team names with Slack markup** (`<!channel>`, `*x*`): shown escaped in the preview, the result and the Teams tab (test in Task 8).

---

### Task 1: Company rules in the schema and the teams module

**Files:**
- Create: `supabase/migrations/20261112100000_company_rules.sql`
- Create: `src/teams/types/rule-set.interface.ts`
- Create: `src/teams/repositories/rule-sets.repository.ts` (+ `.spec.ts`)
- Modify: `src/teams/repositories/teams.repository.ts`, `src/teams/types/team.interface.ts`, `src/teams/teams.module.ts`, `src/common/types/database.types.ts` (generated)

**Interfaces:**
- Produces:
  - Table `rule_sets`:
    - `id uuid pk default gen_random_uuid()`
    - `slack_team_id uuid not null references slack_teams on delete cascade`
    - `name text null` (null for the company rules; named sets later)
    - `is_default boolean not null default false`
    - `hr_approvers text[] not null default '{}'`
    - `hr_approvers_rule text not null default 'ANY' check in ('ANY','ALL')`
    - `approval_notification_recipients text[] not null default '{}'`
    - `vacation_policy_id uuid null references vacation_policies on delete set null`
    - `created_at`, `updated_at timestamptz not null default now()`
    - `updated_by uuid null references users on delete set null`
    - unique index `rule_sets_one_default` on `(slack_team_id) where is_default`
  - Column `teams.rule_set_id uuid null references rule_sets on delete set null`. Null means the team has its own rules.
  - The migration inserts one default set for every existing `slack_teams` row. Existing teams keep `rule_set_id` null.
  - `IRuleSetViewModel { id; slack_team_id; name: string | null; is_default: boolean; hr_approvers: string[]; hr_approvers_rule: ApprovalRule; approval_notification_recipients: string[]; vacation_policy_id: string | null; vacation_policy: { id: string; name: string } | null; updated_at: string; updated_by: string | null }`
  - `RuleSetsRepository extends BaseRepository<'rule_sets', IRuleSetViewModel>`, with relation `vacation_policy` (as in `TeamsRepository`).
  - `RuleSetsRepository.ensureDefault(slackTeamId: string): Promise<IRuleSetViewModel>`: `insert … on conflict do nothing`, then select the default. It returns the same row however often it is called.
  - `ITeamViewModel.rule_set_id: string | null`.

- [ ] **Step 1: Write the failing repository spec** `rule-sets.repository.spec.ts` with `recordingDatabase`:
  - `ensureDefault inserts with on conflict do nothing and selects the default of the workspace`. Assert the SQL contains `on conflict do nothing`, `"is_default" = $` and `"slack_team_id" = $`.
- [ ] **Step 2: Run** `pnpm test src/teams/repositories/rule-sets.repository.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Write the migration.** Apply it with `pnpm db:init && pnpm db:types`, then implement the repository and the `rule_set_id` mapping.
- [ ] **Step 4: Run** the spec plus `pnpm test src/teams`. Expected: PASS.
- [ ] **Step 5: Commit** "Store company rules as a rule set per workspace".

### Task 2: The rules resolver and the company rules service

**Files:**
- Create: `src/teams/types/effective-team-rules.interface.ts`
- Create: `src/teams/services/team-rules.service.ts` (+ `.spec.ts`)
- Create: `src/teams/services/company-rules.service.ts` (+ `.spec.ts`)
- Modify: `src/teams/services/teams.service.ts` (create/update params), `src/teams/teams.module.ts` (provide and export both)

**Interfaces:**
- Produces:
  - `IEffectiveTeamRules`:
    ```ts
    {
      team: ITeamViewModel | null;
      followsCompanyRules: boolean; // true for no team
      managerApprovers: string[];
      managerApproversRule: ApprovalRule;
      hrApprovers: string[];
      hrApproversRule: ApprovalRule;
      notificationRecipients: string[];
      vacationPolicyId: string | null;
    }
    ```
  - `TeamRulesService.forTeam(teamId: string | null | undefined, slackTeamId: string): Promise<IEffectiveTeamRules>`
    - A team that is missing from the workspace counts as no team.
    - A team with `rule_set_id` takes level 2, recipients and policy from that set; level 1 always comes from the team.
    - No team: the default set, and an empty level 1.
  - `CompanyRulesService.get(slackTeamId: string): Promise<IRuleSetViewModel>` (`ensureDefault`).
  - `CompanyRulesService.update(slackTeamId: string, params: ICompanyRulesParams, user: IUserViewModel): Promise<IRuleSetViewModel>`, where:
    ```ts
    ICompanyRulesParams {
      hrApprovers: string[];
      hrApproversRule: ApprovalRule;
      notificationRecipients: string[];
      vacationPolicyId: string | null;
    }
    ```
  - `CompanyRulesService.usesPolicy(policyId: string, slackTeamId: string): Promise<boolean>`.
  - `ICreateTeamParams.followsCompanyRules?: boolean` (default `true`: `rule_set_id` = the default set's id); `IUpdateParams.followsCompanyRules?: boolean` (`false` sets `rule_set_id` null).

- [ ] **Step 1: Write the failing specs** (services built with `jest.fn()` repositories):
  - `forTeam(null) returns the company rules with no level 1`.
  - `forTeam of a team that follows company rules takes level 2, recipients and policy from the set and level 1 from the team`.
  - `forTeam of a team with its own rules returns its own columns`.
  - `forTeam of a team id that is not in the workspace returns the company rules`.
  - `update writes the default set and returns it`.
  - `TeamsService.create sets rule_set_id to the default set unless followsCompanyRules is false`.
- [ ] **Step 2: Run** `pnpm test src/teams/services`. Expected: FAIL.
- [ ] **Step 3: Implement** the three signatures above.
- [ ] **Step 4: Run** `pnpm test src/teams`. Expected: PASS.
- [ ] **Step 5: Commit** "Resolve the rules a team or a person follows".

### Task 3: Every reader of team rules goes through the resolver

**Files:**
- Modify:
  - `src/vacation-requests/services/vacation-request-processing.service.ts` (`startWorkflow`, `buildContext`)
  - `src/slack/tabs/vacation-requests/services/vacation-decision-notifications.service.ts` (`recipientsOf`)
  - `src/vacation-requests/services/vacation-usage.service.ts` (`getVacationPolicyIfExists`)
  - `src/vacation-requests/services/vacation-period-usage.service.ts` (`getDaysInPeriod`)
  - `src/vacation-requests/services/vacation-requests.service.ts` (`create`, `update`, `replaceUserVacations`)
  - `src/time-off-logging/services/time-off-logging.service.ts` (`plan`)
  - `src/users/services/user-update-validator.service.ts` (`validateCarryoverDays`)
  - `src/slack/tabs/vacation-policies/services/vacation-policies-tab.service.ts` (teams using a policy: add "company rules")
  - `src/vacation-policies/services/vacation-policies.service.ts` (`delete` refuses while `CompanyRulesService.usesPolicy`)
  - `src/slack/tabs/home/views/home-tab.view.ts:242,281`
  - `src/slack/tabs/users/views/user-vacation-usage-modal.view.ts:20,102` (the "your team has no policy" copy becomes "no vacation policy applies to you")
  - `CLAUDE.md` (Vacation request approval flow and Domain layer: company rules, `TeamRulesService`)
- Test: `test/integration/company-rules.int-spec.ts` (new)

**Interfaces:**
- Consumes: `TeamRulesService.forTeam` (Task 2).
- Produces:
  - **Workflow levels:**
    - Level 1 from `managerApprovers`, level 2 from `hrApprovers`, as today but from the resolver.
    - A person in no team gets level 2 from the company rules when it names anyone other than the requester. Only when no level is left does the HR/Admin fallback run (D14).
  - **Recipients and policy** for people in no team come from the company rules.
  - **`TimeEntryApprovalsService` is unchanged.**

- [ ] **Step 1: Write the failing integration tests** in `company-rules.int-spec.ts`. Set the rules with `CompanyRulesService` through `t.app.get(...)` until Task 4 adds the form.
  - `a request in a team that follows company rules goes to its lead, then to the company's level 2, and the company's recipients hear of the decision`
  - `a request by someone in no team goes to the company's level 2 and is limited by the company policy`
  - `with no level 2 in the company rules a teamless request goes to HR, else the admins`
  - `a team with its own rules ignores the company rules`
  - `a request already waiting keeps its approvers after the company rules change` (D17)
  - `a policy used by the company rules cannot be deleted`
- [ ] **Step 2: Run** `pnpm test:int test/integration/company-rules.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Change each listed reader** to call `teamRulesService.forTeam(teamIdItUsesToday, slackTeamId)` and read the resolved fields. Keep the team each reader uses today: the request's stored team, or the user's current one. Add `TeamsModule` exports to the modules that need them; `TeamsModule` keeps no imports.
- [ ] **Step 4: Run** `pnpm test` and `pnpm test:int`. Expected: PASS; existing specs and int-specs still pass.
- [ ] **Step 5: Commit** "Apply company rules to teams that follow them and to people in no team".

### Task 4: Company rules and a team's own rules in the Teams screen

**Files:**
- Create:
  - `src/slack/tabs/teams/views/company-rules-modal.view.ts`
  - `src/slack/tabs/teams/parsers/company-rules-view-values.parser.ts`
  - `src/slack/tabs/teams/handlers/company-rules-form-submit.handler.ts`
  - `src/slack/tabs/teams/handlers/team-form-rules.handler.ts`
- Modify:
  - `src/slack/enums/integration-callback-id.enum.ts` (`CompanyRulesSubmit`)
  - `src/slack/tabs/teams/enums/teams-tab-view-actions-id.enum.ts` (`CompanyRules`, `TeamFile`; `TeamModalActionId.Rules = 'rules'`)
  - `src/slack/tabs/teams/views/teams-tab.view.ts`
  - `src/slack/tabs/teams/views/team-modal.view.ts`
  - `src/slack/tabs/teams/parsers/team-modal-view-values.parser.ts`
  - `src/slack/tabs/teams/handlers/team-form-submit.handler.ts`
  - `src/slack/tabs/teams/services/teams-tab.service.ts`
  - `src/slack/tabs/teams/teams-tab.module.ts`
- Test: `test/integration/company-rules.int-spec.ts`, `test/integration/policies-and-teams.int-spec.ts`

**Interfaces:**
- Consumes: `CompanyRulesService.get/update`, `ICreateTeamParams.followsCompanyRules` (Task 2).
- Produces:
  - **Teams tab layout:** an actions row under the title with "➕ Add Team" (`add_team`), "⚙️ Company rules" (`company_rules`) and "📄 Set up from a file" (`team_file`, handled in Task 5). The title accessory goes away. Each team says `Rules: company` or describes its own.
  - **Company rules modal** (`CompanyRulesSubmit`, `allowedRoles: [Admin, HR]`):
    - Fields with the team form's block and action ids: `hr_approvers`, `hr_approvers_rule`, `approval_notification_recipients`, `policy`.
    - On success it re-renders Teams with the notice `✅ Company rules saved.`.
    - The handler checks the policy is the workspace's and the approvers have HR or Admin, as `TeamFormSubmitHandler` does.
  - **Team form:**
    - A required `static_select` `rules_block`/`rules` with options `company` ("Company rules") and `own` ("Its own rules"), and `dispatch_action: true`.
    - `TeamFormRulesHandler` (block_actions on `TeamFormSubmit`) rebuilds the modal with `updateView`.
    - With `own`, the level 2, recipients and policy fields show, filled from the company rules for a team that followed them. With `company`, they are left out, and the parser doesn't ask for them.
    - A new team starts on `company`.

- [ ] **Step 1: Write the failing tests:**
  - `HR saves company rules from Teams and a new team follows them`
  - `switching a team to its own rules shows level 2, recipients and policy filled from the company rules`
  - `a team switched back to company rules drops its own values from the tab`
  - `a member cannot open or submit the company rules form` (actOnView/submit with a member: refused)
  - Update `policies-and-teams.int-spec.ts` for the new actions row and the `rules` field.
- [ ] **Step 2: Run** `pnpm test:int test/integration/company-rules.int-spec.ts test/integration/policies-and-teams.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the views, parsers and handlers, and register the handlers in `TeamsTabModule`.
- [ ] **Step 4: Run** the two specs plus `test/integration/access-control.int-spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** "Edit company rules and a team's own rules on Teams".

### Task 5: The team file template

**Files:**
- Create:
  - `src/team-file/team-file.module.ts`
  - `src/team-file/services/team-file-template.service.ts` (+ `.spec.ts`)
  - `src/slack/team-file/team-file-slack.module.ts`
  - `src/slack/team-file/services/team-file-dm.service.ts`
- Modify:
  - `src/slack/tabs/teams/handlers/teams-tab-action.handler.ts` (`team_file`)
  - `src/app.module.ts`, `src/slack/slack.module.ts` (register the modules)

**Interfaces:**
- Produces:
  - `TeamFileTemplateService.build(slackTeamId: string): Promise<string>`:
    - a CSV written with `toCsv`;
    - header `Name,Email,Team,Team lead`;
    - one row per active person, sorted by team name and then name, with people in no team last;
    - Team lead is `yes` when the person is a member of the team and in its `manager_approvers`, else empty;
    - every cell goes through `csvText`.
  - Exported constant `TEAM_FILE_HEADERS = ['Name', 'Email', 'Team', 'Team lead'] as const`.
  - `TeamFileDmService.sendTemplate(user: IUserViewModel): Promise<void>`, via `DmFileService.send`:
    - filename `team-setup.csv`, title `Team setup`;
    - intro: `📄 Here are your people. Fill in *Team* and *Team lead* (\`yes\`), then send the file back to me here. Nothing changes until you check what it will do and press Apply.`
  - The Teams button calls it through `runInBackground` and answers at once.

- [ ] **Step 1: Write the failing tests:**
  - Unit: `build lists active people with their team and lead mark, teams sorted, people without a team last`.
  - Unit: `build escapes a cell that starts like a formula`.
  - Integration, in the new `test/integration/team-file.int-spec.ts`: `HR gets the team file in a DM from Teams`. Assert `t.slackApi.uploadedFiles(token, dmOf(hr))[0]` has filename `team-setup.csv` and its content lines.
- [ ] **Step 2: Run** `pnpm test src/team-file` and `pnpm test:int test/integration/team-file.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** "Send HR a team file listing everyone".

### Task 6: Reading an uploaded team file (CSV or Excel)

**Files:**
- Create: `src/team-file/parsers/team-file.parser.ts` (+ `.spec.ts`), `src/team-file/types/team-file-row.interface.ts`
- Modify:
  - `src/api-clients/third-party/slack-api.client.ts` (`downloadFileBytes`)
  - `src/slack-communication/services/slack-communication.service.ts` (`fetchFileBytes`)
  - `test/integration/support/fake-slack-api.client.ts` (`addFile` accepts `string | Buffer`; `downloadFileBytes`)
  - `src/slack/services/file-upload.service.ts`
  - `src/slack/services/slack-events.service.ts` (`handleFileShared`: the role check allows `ADMIN_AND_HR_ROLES`)
  - `package.json`, `pnpm-lock.yaml` (`exceljs`)

**Interfaces:**
- Produces:
  - `ITeamFileRow { row: number; name: string; email: string; team: string; lead: string }`. `row` is the line number in the file, the header being 1. Values are as written, with spaces trimmed.
  - `parseTeamFile(content: Buffer, fileName: string): Promise<ITeamFileRow[] | null>`:
    - **Excel:** `.xlsx`, or content starting `PK`. Read the first worksheet with `exceljs`.
    - **CSV:** strip the byte order mark. The delimiter is `;` when the header line has more `;` than `,`, else `,`. Use `csv-parse` with `relax_column_count`.
    - **Headers** are matched ignoring case and spaces; Email and Team are required, Name and Team lead optional.
    - Returns `null` when the headers aren't a team file, so the router can say "Unknown file type".
    - More than 1000 data rows throws `BadRequestException('A team file can have up to 1000 rows.')`.
  - `SlackCommunicationService.fetchFileBytes(fileUrl: string, teamId: string, maxBytes: number): Promise<Buffer>`. `fetchFileContent` stays and decodes UTF-8 from it.
  - **Who may share files:** Admin and HR (`handleFileShared`). `user-vacations.csv` stays Admin only: HR gets the ephemeral `⛔ Only admins can import vacations.`, and the job ends without a retry. Routing the team file is Task 8.

- [ ] **Step 1: Write the failing parser specs:**
  - `reads a comma CSV`
  - `reads a semicolon CSV with a byte order mark and CRLF line ends` (Review Focus 1)
  - `reads the first sheet of an xlsx` (build the fixture in the spec with `exceljs` into a Buffer)
  - `matches headers ignoring case and spaces ("team lead", "E-mail" is not Email)`
  - `returns null for a file without Email and Team columns`
  - `refuses more than 1000 rows`
- [ ] **Step 2: Run** `pnpm test src/team-file/parsers`. Expected: FAIL.
  - Integration, in `user-vacations-import.int-spec.ts`: `HR sharing user-vacations.csv is told only admins can import vacations`.
- [ ] **Step 3: Implement** the parser, the byte download (the real client returns `Buffer.from(await response.arrayBuffer())` under the same URL check and size cap), the fake support, and the role check.
- [ ] **Step 4: Run** `pnpm test`, plus `pnpm test:int test/integration/user-vacations-import.int-spec.ts test/integration/admin.int-spec.ts`. Expected: PASS; vacations import unchanged for admins.
- [ ] **Step 5: Commit** "Read team files as CSV or Excel, from Admin or HR".

### Task 7: Planning the changes a team file makes

**Files:**
- Create: `src/team-file/services/team-file-planner.ts` (+ `.spec.ts`), `src/team-file/types/team-file-plan.interface.ts`

**Interfaces:**
- Consumes: `ITeamFileRow` (Task 6), `IUserViewModel`, `ITeamViewModel`.
- Produces:
  - `planTeamFile(rows: ITeamFileRow[], state: ITeamFileState, maxTeams: number): ITeamFilePlan`, a pure function, where:
    ```ts
    ITeamFileState {
      people: IUserViewModel[]; // all, active and not
      teams: ITeamViewModel[];
    }
    ITeamFilePlan {
      createTeams: { key: string; name: string; leadIds: string[]; memberIds: string[] }[];
      assignments: { userId: string; fromTeamId: string | null; toTeamId: string | null; toTeamKey: string | null }[];
      leadChanges: { teamId: string; add: string[]; remove: string[] }[];   // user ids, existing teams only
      promotions: string[];                                                    // user ids, Member → Manager
      nameMatches: { written: string; teamName: string }[];
      teamsWithoutLead: string[];                                              // team names, created or existing, that end with no level 1 approver
      leftWithoutTeam: string[];                                               // user ids in the file with an empty Team
      unusable: { row: number; reason: string }[];
    }
    ```
    - `toTeamKey` names a team to create (its normalized name).
    - Assignments list only people whose team changes.
  - `planDigest(plan: ITeamFilePlan): string`: a sha256 of a canonical JSON with sorted keys and sorted lists.
- **Rules:**
  - **Emails** are trimmed and compared lowercased.
  - **Team names** are trimmed, with repeated spaces collapsed, and compared lowercased (D4). The first spelling in the file names a new team; an existing team keeps its name.
  - **Team lead:** `yes`, `y`, `x`, `true` or `1` (any case) means lead; empty or `no` means not.
  - **Leads and roles:** a lead with the Member role is promoted. Admin and Manager are kept. HR and Finance are unusable (D2).
  - **Lead changes** for an existing team T:
    - `add` = the file's leads of T who aren't approvers yet.
    - `remove` = current approvers who were members of T before and end outside T, or in T without `yes` (D15).
    - Approvers who weren't members of T before are never removed (D3).
  - **People not in the file** are unchanged (D9).
  - **Team limit:** new teams beyond `maxTeams` minus existing make their rows unusable.
- **Unusable-row reasons**, exactly:
  - `"<email> isn't in this Slack workspace"`
  - `"<name> is deactivated"`
  - `"<email> is already on row <n>"`
  - `"Team lead must be yes or empty"`
  - `"<name> is marked as lead but has no team"`
  - `"<name> has the HR role, which can't approve at level 1"` (likewise Finance)
  - `"Logbook allows <maxTeams> teams; <team> would be one more"`

- [ ] **Step 1: Write the failing specs**, one per rule above. Include:
  - `matches " Anna@Company.io " to anna@company.io`
  - `marks the second row of an email as already on the first`
  - `matches "acme  corp" to the existing "Acme Corp" and reports it`
  - `removes a lead the file moves to another team and keeps a non-member approver`
  - `leaves people who are not in the file alone`
  - `the digest is the same for the same plan in another order`
- [ ] **Step 2: Run** `pnpm test src/team-file/services/team-file-planner.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** "Plan what a team file changes".

### Task 8: Storing an upload and previewing it

**Files:**
- Create:
  - `supabase/migrations/20261112110000_team_file_uploads.sql`
  - `src/team-file/repositories/team-file-uploads.repository.ts`
  - `src/team-file/services/team-file-uploads.service.ts` (+ `.spec.ts`)
  - `src/team-file/types/team-file-upload.interface.ts`
  - `src/slack/team-file/views/team-file-message.view.ts`
  - `src/slack/team-file/services/team-file-messages.service.ts`
  - `src/slack/team-file/handlers/team-file-message.handler.ts`
- Modify:
  - `src/slack/enums/integration-callback-id.enum.ts` (`TeamFileMessage`)
  - `src/slack/services/file-upload.service.ts` (routing below)

**Interfaces:**
- Produces:
  - **Table `team_file_uploads`:**
    - `id uuid pk`
    - `slack_team_id uuid not null references slack_teams on delete cascade`
    - `uploaded_by uuid null references users on delete set null`
    - `file_name text not null`
    - `rows jsonb not null`
    - `plan_digest text not null`
    - `status text not null check in ('previewed','applied','canceled','superseded','undone')`
    - `message_channel text`, `message_ts text`
    - `undo jsonb`
    - `created_at timestamptz not null default now()`, `applied_at timestamptz`, `undone_at timestamptz`
  - `ITeamFileUpload`, the view model of a row.
  - `TeamFileUploadsService.receive(rows: ITeamFileRow[], fileName: string, user: IUserViewModel): Promise<{ upload: ITeamFileUpload; plan: ITeamFilePlan }>`:
    - plans against the current state;
    - stores the upload as `previewed`;
    - marks the workspace's other `previewed` uploads `superseded`.
  - `TeamFileUploadsService.setMessage(uploadId: string, slackTeamId: string, channel: string, ts: string): Promise<void>`.
  - `TeamFileUploadsService.cancel(uploadId: string, user: IUserViewModel): Promise<ITeamFileUpload>`. Only a `previewed` upload of the user's workspace can be canceled.
  - **`TeamFileMessageView.preview(plan, names: Map<string, string>, companyRules: IRuleSetViewModel, uploadId: string): KnownBlock[]`:**
    - Sections in this order: the teams it creates, moves, lead changes, promotions, people left without a team, teams without a lead, name matches, unusable rows, the company rules line.
    - The first block is a section `*Here's what <file> will do*`.
    - Buttons in an actions block with `block_id: ViewCallbackId.TeamFileMessage`: `Apply` (style primary, value `apply:<id>`) and `Cancel` (`cancel:<id>`).
    - With nothing to change: only `Nothing to change: the file matches Logbook.` and no buttons.
    - Copy for each section as in the spec's mockup (e.g. `*Acme* : Anna Novak leads, 4 people`, `no lead, so requests go straight to the second approval`).
    - A third button, `Company rules` (value `rules:<id>`), opens the company rules modal from Task 4 with the click's `trigger_id`. This is the spec's "Change" link.
  - `TeamFileMessageHandler`: `@SlackHandler({ callbackId: ViewCallbackId.TeamFileMessage, type: 'block_actions', allowedRoles: ADMIN_AND_HR_ROLES })`, `actionMap` keys `apply`, `cancel`, `undo`, `rules` through `withButtonAction`. Cancel updates the message to `Canceled. Nothing changed.`.
  - The preview is posted with `postMessage(user.slack_id, …)`, a message rather than an ephemeral, so its buttons stay.
  - **`FileUploadService.handleFileUpload` routing:**
    - `user-vacations.csv` goes as in Task 6.
    - A `.csv` or `.xlsx` is downloaded with `fetchFileBytes` and given to `parseTeamFile`. Non-null rows go to `receive`, then the preview is posted.
    - Anything else gets the existing unknown-file message.

- [ ] **Step 1: Write the failing integration tests** (`team-file.int-spec.ts`), sharing the file with `t.slack.event(... 'file_shared' ...)`:
  - `a filled file gets a preview of teams, leads, moves and unusable rows, and nothing changes` (compare `sectionTexts` of the posted message; query `teams` and `users` unchanged)
  - `a file with Slack markup in a team name shows it escaped` (Review Focus 5)
  - `Cancel says nothing changed`
  - `the preview's Company rules button opens the company rules form`
  - `a file that changes nothing says so, with no buttons`
  - `a manager who shares a team file is refused and nothing is stored`
- [ ] **Step 2: Run** `pnpm test:int test/integration/team-file.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration, `pnpm db:init && pnpm db:types`, then implement.
- [ ] **Step 4: Run** the same, plus `pnpm test src/team-file`. Expected: PASS.
- [ ] **Step 5: Commit** "Preview what a team file will change".

### Task 9: Apply

**Files:**
- Modify:
  - `src/team-file/services/team-file-uploads.service.ts`
  - `src/users/services/users.service.ts`, `src/users/repositories/users.repository.ts` (`assignTeams`)
  - `src/users/events/users.events.ts` (new)
  - `src/slack/team-file/services/team-file-messages.service.ts`
  - `src/slack/team-file/views/team-file-message.view.ts`
  - `src/slack/team-file/handlers/team-file-message.handler.ts`

**Interfaces:**
- Consumes: `planTeamFile`, `planDigest` (Task 7), `TeamsService.create/update` (Task 2), `UsersService.update` (role).
- Produces:
  - `UsersService.assignTeams(assignments: { userId: string; teamId: string | null }[], updatedBy: IUserViewModel): Promise<void>`. One transaction; `team_id: null` is written, unlike `update`. It emits `USER_TEAM_CHANGED` for each user whose team changed.
  - `USER_TEAM_CHANGED = 'users.team_changed'`, `UserTeamChangedEvent { userId: string; slackTeamId: string; teamId: string | null; changedBy: string | null }`. Also emitted by `setTeamMembers` and by `update` when `teamId` changes.
  - `TeamFileUploadsService.apply(uploadId: string, user: IUserViewModel)` returns:
    ```ts
    Promise<
      | { kind: 'applied'; plan: ITeamFilePlan }
      | { kind: 'changed'; plan: ITeamFilePlan }
      | { kind: 'closed'; status: string }
    >
    ```
    It runs in one transaction under `transactions.lock(\`team-file:${slackTeamId}\`)`:
    1. Load the upload. It must be the user's workspace's, `previewed`, and posted within 7 days; otherwise `closed`.
    2. Plan again. A different digest stores the new digest and returns `changed`.
    3. Create the teams (`followsCompanyRules: true`, level 1 = the leads' Slack IDs, rule `ANY`, D1).
    4. Assign the teams, update `manager_approvers` of existing teams, and promote (`role: Manager`).
    5. Store `undo` as:
       ```ts
       {
         createdTeamIds: string[];
         assignments: { userId; before: string | null; after: string | null }[];
         approvers: { teamId; before: string[]; after: string[] }[];
         promotions: { userId; before: UserRole }[];
       }
       ```
    6. Set `status = 'applied'` and `applied_at`.
  - **Slack side:**
    - `applied` updates the message to the result, e.g. `✅ Created 3 teams and placed 14 people. Maria Volkova has no team yet.`, with buttons `Open Teams` (`NavigationActionId.Teams`) and `Undo` (`undo:<id>`).
    - `changed` replaces the message with a new preview, headed `Logbook changed since this preview, so here's what the file will do now.`.
    - `closed` for `superseded` says `A newer file replaced this one. Nothing changed.`.
  - The apply runs after Slack's answer, through `runInBackground`.

- [ ] **Step 1: Write the failing integration tests:**
  - `Apply creates the teams following company rules, places people, sets leads and makes a member lead a Manager`
  - `uploading again with an empty Team takes a person out, a removed yes removes the lead, and teams not in the file stay`
  - `a non-member manager approver stays after a re-upload`
  - `a change made between preview and Apply gets a new preview instead`
  - `Apply on a preview replaced by a newer file changes nothing` (Review Focus 4)
  - `rows that can't be used don't stop the rest`
- [ ] **Step 2: Run** `pnpm test:int test/integration/team-file.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, plus `pnpm test src/users`. Expected: PASS.
- [ ] **Step 5: Commit** "Apply a team file in one transaction".

### Task 10: Undo

**Files:**
- Modify: `src/team-file/services/team-file-uploads.service.ts`, the team-file message view, service and handler.

**Interfaces:**
- Produces:
  - `TeamFileUploadsService.undo(uploadId: string, user: IUserViewModel): Promise<{ kind: 'undone'; restored: number; kept: string[]; deletedTeams: string[] } | { kind: 'closed'; reason: string }>`. It runs in one transaction under the same lock.
  - **When it can run:** only on the workspace's latest `applied` upload, within 7 days of `applied_at`.
  - **What it restores:** each recorded `before`, wherever the current value still equals `after`. Everything else is listed in `kept` as text, e.g. `Igor Belov's team, changed since`.
  - **Created teams** that then have no members at all are deleted, with `TeamsService.delete`. Then `status = 'undone'`.
  - **Messages:**
    - Undone: `↩️ Undone: <restored> changes restored.`, followed by the kept list.
    - Closed: `Undo is no longer available: <reason>.`

- [ ] **Step 1: Write the failing tests:**
  - `Undo restores teams, leads and roles and deletes the teams it created`
  - `Undo keeps a team change made by hand after the upload and says so`
  - `Undo is refused after a newer upload was applied`
  - `Undo is refused after 7 days` (`travelTo`)
- [ ] **Step 2: Run** `pnpm test:int test/integration/team-file.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** "Undo the latest team file".

### Task 11: Remove the old team mapping import

**Files:**
- Delete:
  - `src/user-data-import/parsers/user-team-mapping-csv.parser.ts`
  - `src/user-data-import/services/user-team-mapping-import.service.ts` and `.spec.ts`
- Modify:
  - `src/user-data-import/user-data-import.module.ts`
  - `src/slack/services/file-upload.service.ts`
  - `src/slack/controllers/slack-admin-commands.controller.ts` (drop `POST /user-team-mapping-upload`)
  - `src/slack-communication/services/slack-command-prompts.service.ts` (drop the `teams` kind and its prompt)
  - `src/slack/tabs/users/enums/users-tab-view-action-id.enum.ts`, `src/slack/tabs/users/views/users-tab.view.ts`, `src/slack/tabs/users/handlers/users-tab-action.handler.ts` (drop "📥 Import teams (CSV)")
  - `slack-app-manifest.yml` (drop `/user-team-mapping`)
  - `test/integration/admin.int-spec.ts` (drop the `user-team-mapping.csv` describe)
  - `test/integration/users-tab.int-spec.ts:96-100`
  - `test/integration/enterprise-grid.int-spec.ts:28-56` (use `/api/slack/admin/user-vacations-upload`)
  - `CLAUDE.md` (CSV imports: replace the mapping file with the team file; `file_shared` routing by name or columns), `README.md:31`

- [ ] **Step 1:** `grep -rn "user-team-mapping\|UserTeamMapping\|ImportTeams" src test slack-app-manifest.yml README.md CLAUDE.md`. Every hit is in the list above.
- [ ] **Step 2: Remove and update.**
- [ ] **Step 3: Run** `npx tsc --noEmit && pnpm lint && pnpm test && pnpm test:int`. Expected: PASS, and the grep from Step 1 finds nothing.
- [ ] **Step 4: Commit** "Replace the team mapping CSV with the team file".

### Task 12: Asking HR to place new people

**Files:**
- Create:
  - `supabase/migrations/20261112120000_new_person_prompts.sql`
  - `src/team-file/repositories/new-person-prompts.repository.ts` (exported by `TeamFileModule`)
  - `src/team-file/constants/jobs.ts` (`NEW_PERSON_PROMPT_JOB`; `team-setup` and `SlackEventsService` enqueue it by name, and the Slack service defines it)
  - `src/slack/team-file/services/new-person-prompts.service.ts`
  - `src/slack/team-file/views/new-person-prompt.view.ts`
  - `src/slack/team-file/handlers/new-person-prompt.handler.ts`
- Modify:
  - `src/team-setup/team-users-sync.service.ts` (`syncUsers` returns the created users)
  - `src/team-setup/team-setup-workflow.service.ts` (the sync job marks the first import and asks about later ones)
  - `src/slack-teams/services/slack-teams.service.ts` (`markMembersImported`)
  - `src/slack/services/slack-events.service.ts` (`handleUserJoin` asks about a new person)
  - `src/slack/enums/integration-callback-id.enum.ts` (`NewPersonPrompt`)
  - `test/integration/support/slack-test-client.ts` (`actOnMessage(..., value?: string)`, as `actOnView`)
  - `CLAUDE.md` (Background jobs: the new-person prompt)

**Interfaces:**
- Produces:
  - Column `slack_teams.members_imported_at timestamptz null`. The migration sets `now()` on existing rows.
  - Table `new_person_prompts`:
    - `id uuid pk`
    - `slack_team_id uuid not null references slack_teams on delete cascade`
    - `user_id uuid not null references users on delete cascade` (the new person)
    - `recipient_slack_id text not null`, `channel text not null`, `ts text not null`
    - `closed_at timestamptz`, `created_at timestamptz not null default now()`
  - `SlackTeamsService.markMembersImported(slackTeamId: string): Promise<boolean>`: true when it set the column now; it doesn't overwrite.
  - `TeamUsersSyncService.syncUsers(params): Promise<IUserViewModel[]>`.
  - **The sync job:**
    - If the workspace had `members_imported_at` before the run, it enqueues `NEW_PERSON_PROMPT_JOB = 'new-person-prompt'` with `{ slackTeamId, userId }` for each created user.
    - Otherwise it only marks the import done, so the install and restore imports ask nothing.
    - `handleUserJoin` enqueues the same job for a created user when `members_imported_at` is set.
  - **`NewPersonPromptsService`:**
    - The job sends one DM to each of `fallbackApprovers` (HR, else admins), unless the person already has a team or is inactive.
    - Text: `👋 *<Name>* joined Slack. Which team is <Name> on?`, then context `Until then, <Name>'s requests go to the company's second approval.`.
    - Actions block `block_id: ViewCallbackId.NewPersonPrompt`: a `static_select` `choose_team` with option values `<userId>|<teamId>` (the workspace's teams by name, at most 100), and a button `not_yet` with value `not_yet:<userId>`.
    - Saves each message in `new_person_prompts`. It is safe to run twice: it skips recipients that already have a row for the person.
  - **`NewPersonPromptHandler`** (`allowedRoles: ADMIN_AND_HR_ROLES`):
    - `choose_team` checks the person and team are the workspace's, then calls `UsersService.assignTeams([{ userId, teamId }], user)`.
    - `not_yet` closes the person's prompts as `⏸ <Actor> left <Name> without a team for now.`
  - `@OnEvent(USER_TEAM_CHANGED)` in `NewPersonPromptsService` closes the person's open prompts as `✅ <Actor> placed <Name> in <Team>.`, or `✅ <Name> is in <Team>.` when there's no actor. Whatever placed them: prompt, form, People or the file.

- [ ] **Step 1: Write the failing tests** in `test/integration/new-people.int-spec.ts`:
  - `a person who joins after the install import gets HR a DM with the teams`
  - `the install import asks nothing`
  - `the daily sync asks about a person it adds`
  - `choosing a team places the person and updates every HR's message`
  - `Not yet closes the question for everyone and the person stays without a team`
  - `placing the person on People closes the open questions`
  - `a member cannot answer the question`
  - Update `install.int-spec.ts` and `workspace-events.int-spec.ts` if their counts of posted messages change.
- [ ] **Step 2: Run** `pnpm test:int test/integration/new-people.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration, `pnpm db:init && pnpm db:types`, then implement.
- [ ] **Step 4: Run** `pnpm test:int` and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** "Ask HR which team a new person is on".

### Task 13: Checklist and welcome message

**Files:**
- Modify:
  - `src/slack/tabs/home/services/setup-progress.service.ts`
  - `src/slack/tabs/home/views/home-tab.view.ts` (`getSetupBlocks`)
  - `src/slack/tabs/home/handlers/home-tab-action.handler.ts` (the team file button checks `ADMIN_AND_HR_ROLES` itself)
  - `src/team-setup/team-setup-workflow.service.ts` (`WELCOME_TEXT`)
  - `test/integration/first-setup.int-spec.ts`, `test/integration/install.int-spec.ts:178`
  - `CHANGELOG.md`

**Interfaces:**
- Consumes: `CompanyRulesService.get`, `TeamFileDmService.sendTemplate`.
- Produces:
  - `ISetupProgress` gains `hasCompanyApprovers: boolean`: the company rules name a level 2 approver, or every team has its own rules.
  - `hasTeamWithApprovers` becomes: some team's effective rules have a level 1 or level 2 approver.
  - The checklist shows when any of the four steps (D16) isn't done. Steps are keyed `policy`, `rules`, `team`, `people`, `projects`. `rules` opens the company rules modal (`company_rules`); `team` has "📄 Set up from a file" (`team_file`) and "Teams".
  - `WELCOME_TEXT`:
    ```
    👋 *Logbook is installed, and you're its admin.* Set it up in the app's *Home* tab, in this order:
    1. *More → Policies*: a vacation policy, with its days and holidays. Without one, time off is tracked with no limits.
    2. *More → Teams → Company rules*: who approves after the team lead (HR, leadership), who hears of decisions, and the policy.
    3. *More → Teams → Set up from a file*: fill in everyone's team and team lead, then send the file back.
    4. *More → Projects*: projects, if you track time.
    Until that is done, Home shows a checklist.
    ```

- [ ] **Step 1: Write the failing tests:**
  - `the checklist shows company rules until they name a second approver`
  - `the checklist's file button sends HR the team file`
  - `the checklist is gone once policy, rules, a team with approvers and everyone in a team are done`
  - `install.int-spec` asserts the new `WELCOME_TEXT`.
- [ ] **Step 2: Run** `pnpm test:int test/integration/first-setup.int-spec.ts test/integration/install.int-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add a CHANGELOG entry for company rules, the team file and new-person prompts.
- [ ] **Step 4: Run** `npx tsc --noEmit && pnpm lint && pnpm test && pnpm test:int`. Expected: PASS.
- [ ] **Step 5: Commit** "Walk the checklist through company rules and the team file".
