# Away Approvers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vacation requests and time entries stop waiting for approvers who are on approved time off today; they go on to the next person at work, and a person always makes the final decision.

**Architecture:** `UsersService.findAway` answers who is away on a date, from one SQL condition that the time entry rule shares. A pure function, `planMoveOn`, replaces the loop of `RequestWorkflowService.activateNextLevel`: given the request's current run, the level it waits on and who is away, it says which steps to approve as their approver (the rule of #90 that exists today), which to skip, and what comes next (wait, ask a level, add a fallback level, approve). One private `moveOn` applies it inside the decision's transaction, for a new request (`create`), after an approval (`approveStep`, `approveCurrentLevel`), after someone loses the right to approve (`dropApprover`) and for the check while a request waits (`skipAway`, the same shape as `dropApprover` with Skipped instead of Canceled). `AbsenceCheckService` runs `skipAway` daily per workspace and when same-day time off is approved. Time entries get the same rule in SQL (`TimeEntriesRepository.approves`), split into whose inbox an entry is in and who is told.

**Tech Stack:** NestJS 11, TypeScript, Kysely 0.28 on Postgres (Supabase), pg-boss 10 jobs, EventEmitter2, Jest (unit + integration against local Supabase).

**Spec:** `docs/superpowers/specs/2026-11-10-away-approvers-design.md` (issue dvovna/logbook#66). Read it before any task.

## Global Constraints

- Away = a vacation request with status `approved`, any type (sick leave included), `start_date <= date <= end_date`; the date is the UTC date, `todayIso()` (`src/common/utils/period-presets.ts`), passed into SQL as a parameter (`Date` is faked in the integration tests, Postgres' clock is not). Pending time off never counts.
- "Until" = the covering request's `end_date`, shown with `formatDate` (`24 Jun 2026`). Adjacent requests are not chained.
- A skip never leaves a request waiting only for people who are away; when nobody who could decide is at work, nothing is skipped, but a skip that completes a level which has an approval is made.
- A request is never approved unless its last level has a person's approval (an approval carried over by the rule of #90 is a person's).
- Fallback approvers = active people with the HR role, else with the Admin role, never the requester, without the away ones (`fallbackApprovers` in `src/users/utils/fallback-approvers.utils.ts`, given the people at work); only when that leaves nobody and the request would otherwise wait with nobody asked are the away ones asked.
- A fallback level added mid-flow is new steps one level above the run's highest, ANY rule, named "HR approval" or "Admin approval". This replaces `dropApprover`'s fallback at the emptied level's number.
- Daily check: once per workspace per UTC day, from 06:00 UTC, claimed through `slack_teams.absence_check_date`. Requests added from a leave history file (`VacationRequestsService.addImported`) emit no event; the next daily check covers them.
- Domain code (`src/request-workflows`, `src/vacation-requests`, `src/time-entries`, `src/users`) never imports `src/slack`; Slack messages come from listeners and jobs in `src/slack`.
- Decisions: one transaction, advisory lock `workflowLock(requestId)` (`lockRequest`), conditional updates on open steps only, jobs saved with `jobs.enqueue` inside the transaction, events that must be saved with it through `emitAsync`.
- Lint: interfaces start with `I`; every class member has `public`/`private`/`protected`; imports use `@modules/...`, `@common/...` or `src/...`, never `../`. Run `pnpm lint` and `npx tsc --noEmit` before each commit.
- Comments only for what the code doesn't say (why, constraints, races).
- Commits: short imperative one-line messages, no trailers.
- Integration tests start at `TEST_NOW` = Wednesday 2026-06-17 09:00 UTC; `travelTo('YYYY-MM-DD')` (`test/integration/support/clock.ts`) moves to 09:00 UTC of that day; `await t.idle()` before asserting. Away fixtures are `workspace.addVacationRequest(person, { start_date, end_date })` (approved annual leave unless `status`/`type` say otherwise). Teams with an HR level pass `rule_set_id: null`.

## Review Focus

1. A skip job that runs after the request was approved, rejected or canceled changes nothing (Task 4: `skipAway does nothing for a request with no open steps`).
2. Date edges: time off that ends today or starts today counts; one that ended yesterday or starts tomorrow doesn't (Task 1).
3. One person listed in both levels and away: both steps are skipped and the request falls back, not approved (Task 3: `skips one person listed in both levels and falls back`).
4. A retry of the start-workflow job after a skip at creation doesn't ask the skipped approver (Task 4: `create retried after a skip asks nobody new`).
5. The rule of #90 keeps working through the planner: `vacation-approval.int-spec.ts` → `someone on both levels` passes unchanged.
6. `dropApprover` now goes through the same planner: its fallback level moves one level up and leaves away people out; the `approvers who can no longer decide` tests pass unchanged.
7. Before 06:00 UTC, and for an uninstalled workspace, the daily check does nothing (Task 6).

---

### Task 1: Who is away

**Files:**
- Create: `src/users/types/absence.interface.ts`
- Create: `src/users/repositories/time-off-condition.ts`
- Modify: `src/users/repositories/users.repository.ts`
- Modify: `src/users/services/users.service.ts`
- Test: `test/integration/away-approvers.int-spec.ts` (new; later tasks add to it)

**Interfaces:**
- Produces:
  - `export interface IAbsence { userId: string; since: string; until: string }` (dates YYYY-MM-DD; `since`/`until` are the covering request's `start_date`/`end_date`)
  - `time-off-condition.ts`: `coversDay(requestAlias: string, date: string): RawBuilder<boolean>` (`<alias>.status = 'approved' and <alias>.start_date <= $date::date and <alias>.end_date >= $date::date`) and `onTimeOff(userIdRef: string, slackTeamId: string, date: string): RawBuilder<boolean>` (`exists` a `vacation_requests` row of the workspace for that user with `coversDay`). The one definition of "away"; Task 8 uses `onTimeOff`.
  - `UsersRepository.findAway(slackTeamId: string, date: string): Promise<{ id: string; slack_id: string; since: string; until: string }[]>`
  - `UsersService.findAway(slackTeamId: string, date: string): Promise<Map<string, IAbsence>>`, keyed by Slack user ID

- [ ] **Step 1: Write the failing integration test**

`describe('Approvers who are away')` with the setup of `vacation-approval.int-spec.ts` (`createTestApp` in `beforeAll`, `t.createWorkspace()` in `beforeEach`), and:

```ts
describe('who is away', () => {
  it('counts approved time off of any type that covers the day', async () => {
    const onLeave = await workspace.addUser();
    const sick = await workspace.addUser();
    const endsToday = await workspace.addUser();
    const startsToday = await workspace.addUser();
    await workspace.addVacationRequest(onLeave, { start_date: '2026-06-15', end_date: '2026-06-24' });
    await workspace.addVacationRequest(sick, { start_date: '2026-06-17', end_date: '2026-06-17', type: 'sick_leave' });
    await workspace.addVacationRequest(endsToday, { start_date: '2026-06-10', end_date: '2026-06-17' });
    await workspace.addVacationRequest(startsToday, { start_date: '2026-06-17', end_date: '2026-06-19' });

    const away = await t.app.get(UsersService).findAway(workspace.id, '2026-06-17');

    expect(Object.fromEntries(away)).toEqual({
      [onLeave.slack_id]: { userId: onLeave.id, since: '2026-06-15', until: '2026-06-24' },
      [sick.slack_id]: { userId: sick.id, since: '2026-06-17', until: '2026-06-17' },
      [endsToday.slack_id]: { userId: endsToday.id, since: '2026-06-10', until: '2026-06-17' },
      [startsToday.slack_id]: { userId: startsToday.id, since: '2026-06-17', until: '2026-06-19' },
    });
  });

  it('leaves out pending, rejected, past, future and other workspaces’ time off', async () => {
    const pending = await workspace.addUser();
    const rejected = await workspace.addUser();
    const past = await workspace.addUser();
    const future = await workspace.addUser();
    await workspace.addVacationRequest(pending, { start_date: '2026-06-17', end_date: '2026-06-18', status: 'pending' });
    await workspace.addVacationRequest(rejected, { start_date: '2026-06-17', end_date: '2026-06-18', status: 'rejected' });
    await workspace.addVacationRequest(past, { start_date: '2026-06-10', end_date: '2026-06-16' });
    await workspace.addVacationRequest(future, { start_date: '2026-06-18', end_date: '2026-06-19' });
    const other = await t.createWorkspace();
    await other.addVacationRequest(await other.addUser(), { start_date: '2026-06-17', end_date: '2026-06-17' });

    expect((await t.app.get(UsersService).findAway(workspace.id, '2026-06-17')).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: FAIL, `findAway` is not a function.

- [ ] **Step 3: Implement**

Repository: `selectInWorkspace(slackTeamId)` on `users`, inner join `vacation_requests` on `vacation_requests.user_id = users.id` and `vacation_requests.slack_team_id = users.slack_team_id`, where `coversDay('vacation_requests', date)`; select `users.id`, `users.slack_id`, `min(start_date)::text as since`, `max(end_date)::text as until`; group by `users.id`, `users.slack_id`. Service maps the rows to the `Map`.

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/users test/integration/away-approvers.int-spec.ts
git commit -m "Find who is on approved time off on a date"
```

---

### Task 2: Skipped steps: storing them and how they show

**Files:**
- Modify: `src/request-workflows/types/request-workflow-step.interface.ts`
- Modify: `src/common/enums/request-workflow-status.enum.ts`
- Modify: `src/request-workflows/repositories/request-workflow-steps.repository.ts`
- Modify: `src/request-workflows/services/request-workflow-steps.service.ts`
- Modify: `src/slack/common/views/data/labels.ts` (`STEP_STATUS_LABELS` is a `Record` over the enum, so tsc needs it)
- Modify: `src/slack/approvals/views/approver-message.view.ts`
- Modify: `src/slack/approvals/step-processors/approver-step.processor.ts` (`updateMessage`)
- Modify: `src/slack/approvals/utils/decision-notice.ts`
- Modify: `src/slack/tabs/vacation-requests/views/vacation-request-details-modal.view.ts` (`getStepSummary`)
- Test: `src/request-workflows/repositories/request-workflow-steps.repository.spec.ts` (new), `src/slack/approvals/views/approver-message.view.spec.ts` (new), `src/slack/approvals/utils/decision-notice.spec.ts`

**Interfaces:**
- Produces:
  - `WorkflowStepStatus.Skipped = 'skipped'`; `RequestWorkflowStatus.Skipped = 'skipped'`
  - `IApproverStepData` gains `skip_reason?: 'time_off'` and `away_until?: string | null`
  - `RequestWorkflowStepsRepository.skip(params: { slackTeamId: string; requestId: string; stepId: string; awayUntil: string }): Promise<IRequestWorkflowStepViewModel | null>`
  - `RequestWorkflowStepsService.skip(step: IRequestWorkflowStepViewModel, awayUntil: string): Promise<IRequestWorkflowStepViewModel | null>` (null when the step was already closed)
  - `IFindParams.slackUserIds?: string[]` in `RequestWorkflowStepsService` (a list filter on `slack_user_id`)
  - `STEP_STATUS_LABELS[WorkflowStepStatus.Skipped] = { label: 'Skipped', icon: '⏭️' }`
  - `ApproverMessageView.getMessage` params gain `wentOnTo?: string` (the name of the level the request went on to)

- [ ] **Step 1: Write the failing tests**

```ts
// request-workflow-steps.repository.spec.ts
it('skips one open step, saying until when its approver is away', async () => {
  const { database, sqlOf, parametersOf } = recordingDatabase([[]]);

  await expect(
    new RequestWorkflowStepsRepository(database).skip({
      slackTeamId: 'team-1', requestId: 'request-1', stepId: 'step-1', awayUntil: '2026-06-24',
    }),
  ).resolves.toBeNull();

  expect(sqlOf(0)).toContain('update "request_workflow_steps"');
  expect(sqlOf(0)).toContain('"completed_at" is null');
  expect(sqlOf(0)).toContain("'decided_by_slack_id', null");
  expect(parametersOf(0)).toEqual(
    expect.arrayContaining(['skipped', 'time_off', '2026-06-24', 'team-1', 'request-1', 'step-1']),
  );
});

// approver-message.view.spec.ts
it('shows a skipped step without buttons, and where the request went', () => {
  const message = ApproverMessageView.getMessage({ step: skippedStep /* Skipped, away_until '2026-06-24' */, wentOnTo: 'HR approval' });
  expect(JSON.stringify(message)).toContain("⏭️ Skipped while you're on time off (until 24 Jun 2026). It went on to HR approval.");
  expect(message.blocks.some((block) => block.type === 'actions')).toBe(false);
});

it('leaves out where it went when no other level was asked', () => {
  expect(JSON.stringify(ApproverMessageView.getMessage({ step: skippedStep }))).toContain(
    "⏭️ Skipped while you're on time off (until 24 Jun 2026).\\n",
  );
});

// decision-notice.spec.ts
it('says the request went on without the approver while they are on time off', () => {
  expect(decisionNotice(skippedStep, { slack_id: 'U_A' }, WorkflowStepStatus.Approved, 'done')).toBe(
    'Not decided: it went on without you while you are on time off.',
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test src/request-workflows/repositories src/slack/approvals`
Expected: FAIL (`skip` missing; no Skipped case).

- [ ] **Step 3: Implement**

- `skip`: `updateInWorkspace` like `decide`, one open step (`id`, `request_id`, `completed_at is null`): `step_data || jsonb_build_object('status', ${RequestWorkflowStatus.Skipped}::text, 'decided_at', <decide's expression>, 'decided_by_slack_id', null, 'skip_reason', ${'time_off'}::text, 'away_until', ${awayUntil}::text)`, `completed_at = now()`, `updated_at = now()`, `returningAll`; the mapped row, or null. Nobody decided a skip, so no `decided_by_slack_id`.
- `ApproverMessageView`: `case WorkflowStepStatus.Skipped` → `text: "⏭️ Skipped while you're on time off"`, one section: `⏭️ Skipped while you're on time off (until ${formatDate(away_until)}).` plus ` It went on to ${wentOnTo}.` when given, a blank line, then `getRequestDetails(step, comments)`.
- `ApproverStepProcessor.updateMessage`: for a Skipped step, `wentOnTo` = the `level_name` (else `Level N`) of the lowest level above the step's, in its run (`runOf`), that has a step with `processed_at` set; undefined when there is none (another approver of the same level still decides).
- `decisionNotice`: before the Canceled case, a Skipped step → the text above.
- Details timeline (`getStepSummary`): a Skipped step reads `⏭️ *Skipped* · <@${slack_user_id}> on time off until ${formatDate(away_until)}`; other statuses unchanged.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm test src/request-workflows src/slack/approvals && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/request-workflows src/common/enums src/slack/common/views/data/labels.ts src/slack/approvals src/slack/tabs/vacation-requests/views
git commit -m "Store skipped approval steps and show them"
```

---

### Task 3: How a request moves on, as a pure function

**Files:**
- Create: `src/request-workflows/utils/move-on-plan.ts`
- Test: `src/request-workflows/utils/move-on-plan.spec.ts`

**Interfaces:**
- Consumes: `IAbsence` (Task 1), `WorkflowStepStatus` (Task 2).
- Produces:

```ts
export interface IMoveOnInput {
  steps: IRequestWorkflowStepViewModel[]; // the request's current run (currentRunOf), as it is now
  waitingOn: number | null;               // the level it waits on; null: the request was just made
  away: ReadonlyMap<string, IAbsence>;
  fallbackAtWork: boolean;                // someone at work to make a fallback level of
}
export type MoveOnNext =
  | { kind: 'wait' }                                   // the level waited on still has someone at work
  | { kind: 'ask'; level: number; after: number | null }
  | { kind: 'approve'; level: number }                 // the last level is done by an approval
  | { kind: 'fallback'; after: number | null };
export interface IMoveOnPlan {
  approveAs: IRequestWorkflowStepViewModel[]; // #90: approved as their approver (ANY: the level's first, whose decision closes the level)
  skip: IRequestWorkflowStepViewModel[];
  next: MoveOnNext;
}
export const planMoveOn = (input: IMoveOnInput): IMoveOnPlan;
```

`after` is the last level done by an approval before the asked one, else `waitingOn`: the level the requester's notice reports on.

- [ ] **Step 1: Write the failing tests**

Helpers: `step(id, slackUserId, level, overrides = {})` (open, Pending, ANY); `approved(step, by = step.slack_user_id)` (Approved, `decided_by_slack_id: by`, `completed_at` set); `canceled(step)`; `all(step)` (rule ALL). `away = new Map([['U_A', { userId: 'user-a', since: '2026-06-15', until: '2026-06-24' }]])`. `a1`/`a2` are U_A's steps at levels 1/2, `b1` U_B's at level 1, `h2` U_H's at level 2, `x1`/`x2` U_X's at levels 1/2. Each test is `expect(planMoveOn({ steps, waitingOn, away, fallbackAtWork })).toEqual({ approveAs, skip, next })`:

| test | steps | waitingOn | fallbackAtWork | approveAs | skip | next |
|---|---|---|---|---|---|---|
| `asks level 1 of a new request when nobody is away` | `b1, h2` | null | false | `[]` | `[]` | ask 1, after null |
| `skips the away approver and asks the one at work` | `a1, b1` | null | false | `[]` | `[a1]` | ask 1, after null |
| `skips a level whose approvers are all away and asks the next` | `a1, h2` | null | false | `[]` | `[a1]` | ask 2, after null |
| `falls back when the last level would be skipped` | `a1` | null | true | `[]` | `[a1]` | fallback, after null |
| `skips one person listed in both levels and falls back` | `a1, a2` | null | true | `[]` | `[a1, a2]` | fallback, after null |
| `changes nothing when nobody who could decide is at work` | `a1, a2` | null | false | `[]` | `[]` | ask 1, after null |
| `keeps waiting for the approver at work` | `a1, b1` | 1 | false | `[]` | `[a1]` | wait |
| `completes an ALL level that has an approval when the rest are away` | `all(approved(b1)), all(a1)` | 1 | false | `[]` | `[a1]` | approve 1 |
| `moves on to the next level after an approval` | `approved(b1), h2` | 1 | false | `[]` | `[]` | ask 2, after 1 |
| `falls back instead of approving when the last level is skipped` | `approved(b1), a2` | 2 | true | `[]` | `[a2]` | fallback, after 2 |
| `changes nothing while it waits when everyone who could decide is away` | `a1, a2` | 1 | false | `[]` | `[]` | wait |
| `approves for someone who approved this run already (#90)` | `approved(x1), x2, h3` | 1 | false | `[x2]` | `[]` | ask 3, after 2 |
| `leaves the others of an ALL level to decide (#90)` | `approved(x1), all(x2), all(h2)` | 1 | false | `[x2]` | `[]` | ask 2, after 1 |
| `approves when #90 completes the last level` | `approved(x1), x2` | 1 | false | `[x2]` | `[]` | approve 2 |
| `asks the next level, away or not, when a dropped approver empties the level and nobody is at work` | `canceled(b1), a2` | 1 | false | `[]` | `[]` | ask 2, after 1 |
| `falls back when a dropped approver empties the last level` | `canceled(b1)` | 1 | false | `[]` | `[]` | fallback, after 1 |

(`h3` is U_H's step at level 3.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test src/request-workflows/utils/move-on-plan.spec.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `planMoveOn`**

```ts
const isApproved = (s: Step) => s.step_data.status === WorkflowStepStatus.Approved;
const approvers = new Set(steps.filter(isApproved).map((s) => s.step_data.decided_by_slack_id ?? s.slack_user_id));
const levels = [...new Set([
  ...(waitingOn === null ? [] : [waitingOn]),
  ...steps.filter((s) => !s.completed_at && s.step_level > (waitingOn ?? 0)).map((s) => s.step_level),
])].sort((a, b) => a - b);
const approveAs: Step[] = [];
const skip: Step[] = [];
// Levels skipped with nobody's approval since the last level an approval completed.
let skipped: { level: number; steps: Step[]; open: boolean }[] = [];
let after = waitingOn;

for (const level of levels) {
  const atLevel = steps.filter((s) => s.step_level === level);
  let open = atLevel.filter((s) => !s.completed_at);
  let approved = atLevel.some(isApproved);

  if (level !== waitingOn) {
    const theirs = open.filter((s) => approvers.has(s.slack_user_id));
    const anyRule = theirs[0]?.step_data.rule === ApprovalRule.Any;
    approveAs.push(...(anyRule ? theirs.slice(0, 1) : theirs));
    open = anyRule ? [] : open.filter((s) => !theirs.includes(s));
    approved ||= theirs.length > 0;
  }

  const awayHere = open.filter((s) => away.has(s.slack_user_id));

  if (open.length > awayHere.length) {
    return {
      approveAs,
      skip: [...skip, ...skipped.flatMap((l) => l.steps), ...awayHere],
      next: level === waitingOn ? { kind: 'wait' } : { kind: 'ask', level, after },
    };
  }

  if (approved) {
    skip.push(...skipped.flatMap((l) => l.steps), ...awayHere);
    skipped = [];
    after = level;
  } else {
    skipped.push({ level, steps: awayHere, open: open.length > 0 });
  }
}

if (!skipped.length) return { approveAs, skip, next: { kind: 'approve', level: levels[levels.length - 1] } };
if (fallbackAtWork) return { approveAs, skip: [...skip, ...skipped.flatMap((l) => l.steps)], next: { kind: 'fallback', after } };

// Nobody who could take it is at work: no skip that leaves it waiting only for people who are away.
const first = skipped.find((l) => l.open);
return {
  approveAs,
  skip,
  next: !first ? { kind: 'fallback', after } : first.level === waitingOn ? { kind: 'wait' } : { kind: 'ask', level: first.level, after },
};
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm test src/request-workflows/utils/move-on-plan.spec.ts && npx tsc --noEmit`
Expected: PASS (16 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/request-workflows/utils
git commit -m "Work out how a request moves on past approvers on time off"
```

---

### Task 4: The workflow moves on by the plan

**Files:**
- Modify: `src/request-workflows/services/request-workflow.service.ts`
- Modify: `src/request-workflows/services/approver-access.service.ts`
- Modify: `src/request-workflows/events/vacation-workflow.events.ts`
- Modify: `src/common/enums/vacation-workflow-event.enum.ts` (the comment of `LevelCompleted`: approved or skipped)
- Test: `src/request-workflows/services/request-workflow.service.spec.ts`, `test/integration/away-approvers.int-spec.ts`

**Interfaces:**
- Consumes: `UsersService.findAway` (Task 1), `RequestWorkflowStepsService.skip` (Task 2), `planMoveOn` (Task 3), `fallbackApprovers`, `currentRunOf`/`runOf`.
- Produces:
  - `RequestWorkflowService.skipAway(requestId: string, slackTeamId: string): Promise<void>`: transaction, `lockRequest`, the current run; no open steps → return; else `moveOn(steps, { waitingOn: <lowest open level>, approvedBy: null })`.
  - `RequestWorkflowService.dropApprover(requestId: string, slackTeamId: string, gone: IUserViewModel)`: the `fallback` parameter goes; it closes `gone`'s open steps as today (Canceled), then `moveOn(<run reloaded>, { waitingOn: <lowest open level before closing>, approvedBy: null })`.
  - `VacationWorkflowLevelCompleted` gains a 5th constructor parameter `skippedStepIds: string[] = []` (the steps this move skipped).
  - Private `moveOn(steps: IRequestWorkflowStepViewModel[], { waitingOn, approvedBy }: { waitingOn: number | null; approvedBy: IUserViewModel | null }): Promise<void>`, inside the caller's transaction and lock; `activateNextLevel` and `isLevelComplete` are deleted.

- [ ] **Step 1: Write the failing unit tests**

In the spec, `usersService` gains `findAway: jest.fn().mockResolvedValue(new Map())` and `findMany: jest.fn().mockResolvedValue([])`; `stepsService` gains `skip: jest.fn(async (step) => ({ ...step, completed_at: 'now', step_data: { ...step.step_data, status: WorkflowStepStatus.Skipped } }))`. Existing tests whose mocks stood for `isLevelComplete` (`count`) or for what `activateNextLevel` read get `findMany` returning the run as the database has it after the decision (the decided steps Approved); their expectations stay, but for `creates a step per approver … starts level 1 only`, which now expects `claimUnprocessed` with `{ requestId: REQUEST_ID, slackTeamId: SLACK_TEAM_ID, stepLevel: 1, completed: false }` and `processSteps` with what it returns. New tests (`U_MANAGER` away until `2026-06-24` where they say so):

- `skips an away manager when the request is made and asks the HR level`: `create` with levels `[[U_MANAGER], [U_HR]]`; expect `stepsService.skip` with the manager's step and `'2026-06-24'`, `claimUnprocessed` with `expect.objectContaining({ stepLevel: 2, completed: false })`, `updateStepMessages` with the skipped step, and no `emitAsync` (the sent-for-approval notice covers a new request).
- `create retried after a skip asks nobody new`: `findMany` returns the run (manager Skipped and closed, HR Pending at level 2); expect `processSteps` with only the HR step and no `createMany`.
- `skipAway does nothing for a request with no open steps`: no `skip`, no `processSteps`, no `emitAsync`.
- `skipAway tells the requester when it asks someone new`: manager's open step at level 1 (processed), HR step at level 2; expect `emitAsync` with `VacationWorkflowEventEnum.LevelCompleted` and `new VacationWorkflowLevelCompleted(REQUEST_ID, SLACK_TEAM_ID, 1, 2, ['step-manager'])`.
- `skipAway adds a fallback level above the highest when the last level is skipped`: level 1 Approved, level 2 the away HR person's open step; `usersService.findMany` → `[the away HR person, an admin]`; expect `createMany` with one step `{ slackUserId: 'U_ADMIN', stepLevel: 3, stepData: expect.objectContaining({ rule: ApprovalRule.Any, level_name: 'Admin approval', status: WorkflowStepStatus.Pending, run: REQUEST_ID }) }`, then `claimUnprocessed` with `stepLevel: 3`, and no `Finished` event.
- `skipAway approves with the latest approval when the rest of the last level is away`: ALL level, `U_B`'s step Approved, away `U_A`'s open; expect a `Finished` event with status Approved and `approvedBy` = the id `findBySlackId('U_B', SLACK_TEAM_ID)` returns.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test src/request-workflows/services/request-workflow.service.spec.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement `moveOn` and rewire the callers**

`moveOn`:
1. `requestId`, `slackTeamId` and the owner (`step_data.snapshot.user_id`) from `steps[0]`. `away = await usersService.findAway(slackTeamId, todayIso())`; `hrAndAdmins = await usersService.findMany({ slackTeamId, roles: [UserRole.HR, UserRole.Admin] })`; `atWork = fallbackApprovers(hrAndAdmins.filter((p) => !away.has(p.slack_id)), ownerId)`.
2. `plan = planMoveOn({ steps, waitingOn, away, fallbackAtWork: !!atWork })`.
3. `approveAs`: decide Approved as `{ slack_id: step.slack_user_id }`, by `stepLevel` under ANY, by `stepId` under ALL (as `activateNextLevel` does now). `skip`: `requestWorkflowStepsService.skip(step, away.get(step.slack_user_id)!.until)` each. `updateStepMessages` with every step those closed.
4. `wait`: done. `approve`: `finishWorkflow` with status Approved, `approvedBy` = `approvedBy?.id`, else the user (`findBySlackId`; users are never deleted) of the latest approval at `plan.next.level` (an `approveAs` step there counts as the latest; else `decided_by_slack_id ?? slack_user_id` of the latest `decided_at`), and the request's comments. `ask`: `claimUnprocessed({ requestId, slackTeamId, stepLevel: level, completed: false })`, `processSteps(claimed)`. `fallback`: `people = atWork ?? fallbackApprovers(hrAndAdmins, ownerId)`; none → `logger.warn` (as `dropApprover` does now) and done; else `createMany` one step each at `Math.max(...steps.map((s) => s.step_level)) + 1`, `rule: ApprovalRule.Any`, `level_name` `'HR approval'` or `'Admin approval'`, `run: runOf(steps[0])`, `snapshot` of `steps[0]`, then claim and process them.
5. When `waitingOn !== null` and something was claimed: `emitAsync(LevelCompleted, new VacationWorkflowLevelCompleted(requestId, slackTeamId, after, askedLevel, skippedIds))`.

Callers:
- `create`: after `createMany`, `moveOn(createdSteps, { waitingOn: null, approvedBy: null })`. Its retry branch processes the open steps of the run's lowest open level (`ask` skips the ones with a message), not level 1. The `NotFoundException` for an empty level 1 goes.
- `approveStep`: after an approval it made, `moveOn(<run reloaded>, { waitingOn: step.step_level, approvedBy })` in place of `isLevelComplete` then `activateNextLevel` (the plan waits while someone at work is left under ALL, and skips the away ones when nobody else is).
- `approveCurrentLevel`: `moveOn(<run reloaded>, { waitingOn: currentStep.step_level, approvedBy })` in place of `activateNextLevel`.
- `dropApprover`: as in Interfaces. `ApproverAccessService.handOver` no longer loads HR and admins nor calls `fallbackApprovers`; it calls `dropApprover(requestId, slackTeamId, user)` per request.

- [ ] **Step 4: Run the unit tests to see them pass**

Run: `pnpm test src/request-workflows`
Expected: PASS.

- [ ] **Step 5: Write the integration tests**

In `away-approvers.int-spec.ts`, `describe('vacation requests')`. Fixtures: `manager` (Manager), `hr` (HR), a `member` in a team; `goAway(person, start = '2026-06-15', end = '2026-06-24')` adds the approved time off. Steps with `workspace.rows('request_workflow_steps')`, DMs with `approvalMessageTo` and `t.slackApi.postedMessages(workspace.token, user.slack_id)`, clicks with `t.slack.actOnMessage(workspace, user, message, ApproverMessageActionId.Approve).expect(200)`.

1. `asks the manager at work when the other one is away (ANY)`: two Manager-role approvers, `manager_approvers: [away, manager]`; only `manager` gets an approval DM; the away one's step has `step_data` `toMatchObject({ status: 'skipped', skip_reason: 'time_off', away_until: '2026-06-24' })` and no `decided_by_slack_id`.
2. `asks the HR level when the only manager is away`: `manager_approvers: [manager]`, `hr_approvers: [hr]`, `rule_set_id: null`, manager away; `hr` gets the approval DM, `manager` none.
3. `asks HR, else the admins, when the only manager is away and there is no HR level`: manager away; the HR person gets the DM, from a step at level 2 named `'HR approval'`; in a second workspace with an admin and no HR person, the admin does (`'Admin approval'`).
4. `waits only for the manager at work under ALL`: `manager_approvers_rule: ApprovalRule.All`, two managers, one away; the other approves; the request is approved.
5. `skips the manager who goes away while the request waits`: HR level set; request made today; `goAway(manager, '2026-06-18', '2026-06-24')`; `travelTo('2026-06-18')`; `await t.app.get(RequestWorkflowService).skipAway(request.id, workspace.id)`; `hr` gets the approval DM; `textOf(t.slackApi.messageUpdates(workspace.token, managerApproval)[0])` contains `⏭️ Skipped while you're on time off (until 24 Jun 2026). It went on to HR approval.`; a second `skipAway` posts and updates nothing more (`t.slackApi.mark()` before it).
6. `falls back instead of approving when the last level is skipped`: the manager approves; `hr` (the only HR person) goes away from tomorrow; `travelTo`; `skipAway`; an admin gets an approval DM from a step named `'Admin approval'`, and the request is still pending.
7. `changes nothing when everyone who could decide is away`: the only manager, the HR person and an admin away; the manager gets the approval DM and no step is skipped.
8. `one outcome when the manager approves as the check skips`: `await Promise.all([click approve, skipAway])`, `t.idle()`; `hr` got exactly one approval DM, and the request is pending.
9. `Approve for Approvers works on a level with skipped steps`: ALL level with one manager away and one at work; HR approves for the approvers (`t.app.get(WorkflowDecisionsService).approveCurrentLevel(request.id, hrViewModel)`, `hrViewModel` from `UsersService.findBySlackId`); the HR level is asked; the skipped step stays skipped.

- [ ] **Step 6: Run them**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts test/integration/vacation-approval.int-spec.ts test/integration/approver-comments.int-spec.ts test/integration/user-access.int-spec.ts test/integration/waiting-requests.int-spec.ts test/integration/company-rules.int-spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/request-workflows src/common/enums test/integration/away-approvers.int-spec.ts
git commit -m "Skip approvers on time off as the workflow moves on"
```

---

### Task 5: Requests nobody on the team can approve go to fallback approvers at work

**Files:**
- Modify: `src/vacation-requests/services/vacation-request-processing.service.ts` (`plan`, `findFallbackApprovers`)
- Test: `src/vacation-requests/services/vacation-request-processing.service.spec.ts`, `test/integration/away-approvers.int-spec.ts`

**Interfaces:**
- Consumes: `UsersService.findAway` (Task 1).

- [ ] **Step 1: Write the failing tests**

Unit (`usersService` mock gains `findAway: jest.fn().mockResolvedValue(new Map())`), in `describe('when nobody on the team can approve it')`:
- `sends it to the admins while every HR person is away`: the workflow has one level `name: 'Admin approval'` with the admins' steps.
- `asks HR anyway when HR and the admins are all away`: the level is `'HR approval'` with the HR people.

Integration: `goes to an admin when the requester has no team and the HR person is away`: the admin gets the approval DM, the HR person none.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test src/vacation-requests/services/vacation-request-processing.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`plan` reads `usersService.findAway(request.slack_team_id, todayIso())` with the rules and approvers; `findFallbackApprovers(request, approvers, away)`: `fallbackApprovers(approvers.filter((p) => !away.has(p.slack_id)), ownerId) ?? fallbackApprovers(approvers, ownerId)`. Team levels keep their away approvers: `create` skips them (Task 4).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm test src/vacation-requests && pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vacation-requests test/integration/away-approvers.int-spec.ts
git commit -m "Leave away people out of fallback approvers"
```

---

### Task 6: The daily check and the same-day trigger

**Files:**
- Create: `supabase/migrations/20261114160000_absence_check_date.sql`
- Modify: `src/common/types/database.types.ts` (regenerated)
- Modify: `src/slack-teams/slack-teams.repository.ts`, `src/slack-teams/slack-teams.service.ts`
- Create: `src/request-workflows/events/absence.events.ts`
- Create: `src/request-workflows/services/absence-check.service.ts`
- Modify: `src/request-workflows/request-workflows.module.ts` (provider, export, `SlackTeamsModule` import)
- Create: `src/vacation-requests/services/approver-absence-trigger.service.ts`; register in `src/vacation-requests/vacation-requests.module.ts`
- Test: `test/integration/away-approvers.int-spec.ts`

**Interfaces:**
- Consumes: `RequestWorkflowService.skipAway` (Task 4), `UsersService.findAway`, `RequestWorkflowStepsService.findMany` with `slackUserIds` (Task 2).
- Produces:
  - `slack_teams.absence_check_date date`, null until the first check (comment: `'UTC day whose check for approvers on time off ran'`)
  - `SlackTeamsRepository.claimAbsenceCheck(id: string, date: string): Promise<boolean>` and `SlackTeamsService.claimAbsenceCheck`, as `claimReminderDay` (installed only; null or earlier date)
  - `export const ABSENCE_DAY_CHECKED = 'absence.day_checked'`; `export class AbsenceDayCheckedEvent { constructor(public readonly slackTeamId: string, public readonly date: string) }`
  - `AbsenceCheckService`:
    - `export const SKIP_AWAY_JOB = 'workflow-skip-away'` (`{ requestId, slackTeamId }` → `skipAway`)
    - `checkAll(now = new Date()): Promise<number>`: 0 before 06:00 UTC (`CHECK_FROM_HOUR_UTC = 6`); else `checkWorkspace` for each of `slackTeamsService.findInstalledIds()`, one failing workspace logged and reported (`reportError`) without stopping the others; returns how many it checked
    - `checkWorkspace(slackTeamId: string, date: string): Promise<boolean>`: one transaction: claim (false → return false), the open asked steps (`completed: false, processed: true`) of the people `findAway(slackTeamId, date)` returns, `jobs.enqueueMany(SKIP_AWAY_JOB, …)` one per request, `emitAsync(ABSENCE_DAY_CHECKED, …)`; true
    - `checkPerson(slackTeamId: string, slackUserId: string): Promise<void>`: in the caller's transaction, `jobs.enqueue(SKIP_AWAY_JOB, …)` per request with an open asked step of theirs
    - `runPeriodically(() => this.checkAll(), { firstAfterMs: 5 min, everyMs: 10 min, … })` in `onModuleInit`, stopped in `onModuleDestroy`, as `TimeEntryRemindersService`
  - `ApproverAbsenceTriggerService`: `@OnEvent(VacationRequestEvent.Created, { suppressErrors: false })` and `@OnEvent(VacationRequestEvent.Updated, { suppressErrors: false })`: when the request is approved and covers `todayIso()`, and (Created, or no `previous`, or `previous` was not approved, did not cover today, or was someone else's), `checkPerson(request.slack_team_id, request.user!.slack_id)`. The workflow's own approval reaches it as `Updated` without `previous` (`finishPending`); HR's edits as `Updated` with it.

- [ ] **Step 1: Write the failing integration tests**

```ts
it('skips at the first check of the day, once', async () => {
  // member's request waits for the manager; HR level set
  await workspace.addVacationRequest(manager, { start_date: '2026-06-18', end_date: '2026-06-24' });
  travelTo('2026-06-18');
  const checks = t.app.get(AbsenceCheckService);

  expect(await checks.checkWorkspace(workspace.id, '2026-06-18')).toBe(true);
  await t.idle();
  expect(t.slackApi.postedMessages(workspace.token, hr.slack_id)).toHaveLength(1);
  expect(await checks.checkWorkspace(workspace.id, '2026-06-18')).toBe(false);
});

it('checks nothing before 06:00 UTC', async () => {
  expect(await t.app.get(AbsenceCheckService).checkAll(new Date('2026-06-18T05:59:00Z'))).toBe(0);
});

it('does not check an uninstalled workspace', async () => {
  await t.db.updateTable('slack_teams').set({ uninstalled_at: new Date().toISOString() }).where('id', '=', workspace.id).execute();
  expect(await t.app.get(AbsenceCheckService).checkWorkspace(workspace.id, '2026-06-17')).toBe(false);
});

it('skips at once when same-day time off is approved', async () => {
  const boss = await workspace.addUser({ role: UserRole.Manager });
  const bossTeam = await workspace.addTeam({ manager_approvers: [boss.slack_id] });
  const lead = await workspace.addUser({ role: UserRole.Manager, team_id: bossTeam.id });
  const team = await workspace.addTeam({ manager_approvers: [lead.slack_id], hr_approvers: [hr.slack_id], rule_set_id: null });
  const member = await workspace.addUser({ team_id: team.id });
  await requestVacation(t, workspace, member, workWeek(2)); // waits for `lead`
  await requestVacation(t, workspace, lead, { start: '2026-06-17', end: '2026-06-19' });

  await t.slack
    .actOnMessage(workspace, boss, await approvalMessageTo(t, workspace, boss), ApproverMessageActionId.Approve)
    .expect(200);
  await t.idle();

  expect(t.slackApi.postedMessages(workspace.token, hr.slack_id)).toHaveLength(1);
});
```

(Never call `checkAll` after 06:00 in a test: it would check every workspace in the local database.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: FAIL, `AbsenceCheckService` not found.

- [ ] **Step 3: Add the migration and regenerate the types**

`alter table public.slack_teams add column if not exists absence_check_date date;` and its comment, as `20261113120000_time_reminder_settings.sql` adds `time_reminder_day`.

Run: `pnpm db:init && pnpm db:types`
Expected: `database.types.ts` gains `absence_check_date` on `slack_teams`.

- [ ] **Step 4: Implement the claim, the event, `AbsenceCheckService` and `ApproverAbsenceTriggerService`**

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts test/integration/schema.int-spec.ts && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations src/common/types/database.types.ts src/slack-teams src/request-workflows src/vacation-requests test/integration/away-approvers.int-spec.ts
git commit -m "Check daily and on same-day approval for approvers on time off"
```

---

### Task 7: What the requester and the approvers read

**Files:**
- Create: `src/slack/common/utils/time-off-text.ts`
- Modify: `src/slack/tabs/vacation-requests/services/vacation-request-progress-notices.service.ts` (`handleLevelCompleted`, `notifyLevelCompleted`, `getSentToText`)
- Modify: `src/slack/approvals/step-processors/approver-step.processor.ts` (`findProgress`)
- Modify: `src/slack/approvals/views/approver-message.view.ts` (`IApprovalProgress`, `getContextLine`)
- Test: `test/integration/away-approvers.int-spec.ts`

**Interfaces:**
- Consumes: `VacationWorkflowLevelCompleted.skippedStepIds` (Task 4), skipped steps (Task 2).
- Produces:
  - `onTimeOffText(slackId: string, until: string): string` → `<@U…> is on time off until 24 Jun 2026`; several joined with `, `.
  - `ILevelNoticeJob.skippedStepIds?: string[]`, passed on by `handleLevelCompleted`.
  - `IApprovalProgress.skipped: { slackId: string; until: string }[]` (Skipped steps of the run at levels below the step's).

Copy (`dates` = `this.datesOf(request)`, `away` = the skipped approvers through `onTimeOffText`):
- Sent: `getSentToText` reads the current run's lowest level with a step that is not Skipped (not level 1), and names that level's steps that are not Skipped. With Skipped steps in the run: `📨 ${away}, so your vacation request (${dates}) went to ${mentions} (${levelName}).`; without, unchanged.
- Level notice: `next` = the steps at `nextLevel` with `processed_at` set (the asked ones), not every step of it; `skipped` = the run's steps whose ids are in `skippedStepIds`. Approvals at `level` and skipped: `✅ Your vacation request (${dates}): ${levelName} done by ${mentions}. ${away}. Now waiting for ${nextLevelName} from ${nextMentions}.`. No approval but skipped: `⏭️ ${away}. Your vacation request (${dates}) now waits for ${nextLevelName} from ${nextMentions}.`. Neither (a level passed over after a drop): no DM, as now.
- Approver context line: after the "approved by" part, `skipped ${skipped.map((s) => `<@${s.slackId}> (on time off until ${formatDate(s.until)})`).join(', ')}`.

- [ ] **Step 1: Write the failing integration tests**

- In test 2 of Task 4 (only manager away at creation): the member's DMs are `[`📨 <@${manager.slack_id}> is on time off until 24 Jun 2026, so your vacation request (${formatDateRange(start, end)}) went to <@${hr.slack_id}> (HR approval).`]`.
- In test 5 (goes away while waiting): the member's last DM is `⏭️ <@${manager.slack_id}> is on time off until 24 Jun 2026. Your vacation request (${formatDateRange(start, end)}) now waits for HR approval from <@${hr.slack_id}>.`; `textOf(<HR's approval DM>)` contains `skipped <@${manager.slack_id}> (on time off until 24 Jun 2026)`.
- In test 4 (ALL, one away) extended with an HR level: after the manager at work approves, the member's last DM is `✅ Your vacation request (…): Manager approval done by <@${other.slack_id}>. Now waiting for HR approval from <@${hr.slack_id}>.` (the skip at creation is not told again).
- `shows a skipped approver in the Details timeline`: after test 2's setup the member opens Details from Time off (`openModalFrom(t, workspace, member, await openAppHomeTab(t, workspace, member, [NavigationActionId.TimeOff]), VacationHistoryTabViewActionId.ManageRequestMenu, `${VacationHistoryTabViewActionId.ViewDetails}:${request.id}`)`); `textOf(details)` contains `⏭️ *Skipped* · <@${manager.slack_id}> on time off until 24 Jun 2026`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: the text assertions FAIL (the timeline one passes already from Task 2).

- [ ] **Step 3: Implement the texts, the job field and the context line**

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts test/integration/vacation-approval.int-spec.ts`
Expected: PASS (the existing `what the requester hears while it waits` tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/slack test/integration/away-approvers.int-spec.ts
git commit -m "Tell the requester and approvers when an approver is skipped"
```

---

### Task 8: Time entries wait for someone at work

**Files:**
- Modify: `src/time-entries/repositories/time-entries.repository.ts` (`approves`, `waitingGroups`, `waitingEntries`, `countWaitingFor`, `findWaitingFor`, `findWaitingIds`, `findApproverIds`)
- Modify: `src/time-entries/services/time-entry-approvals.service.ts` (`listPending`, `countPending`, `waitingFilter`, `groupByApprover`, the class comment)
- Test: `src/time-entries/services/time-entry-approvals.service.spec.ts`, `test/integration/away-approvers.int-spec.ts`

**Interfaces:**
- Consumes: `onTimeOff` (Task 1).
- Produces:
  - `export type EntryApprovers = 'listed' | 'inbox' | 'told'` in the repository file.
  - `approves(slackTeamId, refs, { today, who }: { today: string; who: EntryApprovers })`.
  - `countWaitingFor(slackTeamId, approverId, today)`, `findWaitingFor(slackTeamId, approverId, today, { limit, offset })`, `findWaitingIds(slackTeamId, approverId, today)` (all `'inbox'`); `findApproverIds(slackTeamId, ids, today, who: 'listed' | 'told')`.
  - The service passes `todayIso()`; `groupByApprover` asks for `'told'`.

The rule, per entry (team, owner), with `atWork(p)` = `not onTimeOff(p.id, slackTeamId, today)`:
- `listed(p)`: today's `approves` expression unchanged (the team's active approving managers but the owner, else HR, else admins).
- `fallbackAtWork(p)`: approving, at work, and HR when some approving HR person is at work, else Admin.
- `inbox(p)` = `listed(p)` or (no listed approver is at work and `fallbackAtWork(p)`). The away managers keep the entry in theirs; nothing changes when nobody who could decide is at work.
- `told(p)` = when some listed approver is at work: `listed(p) and atWork(p)`; else when someone is `fallbackAtWork`: `fallbackAtWork(p)`; else `listed(p)`.

- [ ] **Step 1: Write the failing integration tests**

`describe('time entries')`: `manager` approves team Design, `member` in it, `hr` (HR); `submitted(owner)` adds a submitted entry on a project (as `time-approvals.int-spec.ts` does); `approvalsOf(user)` = `buttonText(await openAppHomeTab(t, workspace, user), NavigationActionId.Approvals)`.
- `shows a submitted entry to HR while the team's manager is away, and takes it back when they return`: manager away 2026-06-15..2026-06-19; `submitted(member)`; `approvalsOf(hr)` is `'✅ Approvals (1)'` and so is `approvalsOf(manager)`; HR's inbox lists the entry and Approve all reads `Approve all (1)`; `travelTo('2026-06-22')`; `approvalsOf(hr)` is `'✅ Approvals'`.
- `keeps it with the managers while one of them is at work`: two managers on Design, one away; `approvalsOf(hr)` is `'✅ Approvals'`.
- `adds the admins while HR is away too`: manager and `hr` away, an admin at work: `approvalsOf(admin)` is `'✅ Approvals (1)'`.
- `changes nothing when nobody who could decide is at work`: manager, `hr` and an admin away: `approvalsOf(hr)` and `approvalsOf(admin)` are `'✅ Approvals'`, `approvalsOf(manager)` is `'✅ Approvals (1)'`.
- `tells HR, not the away manager, of submitted time`: manager away; the member submits a draft from Home (`actOnTab(…, HomeTabActionId.SubmitTimeEntries)`); `hr` gets one DM containing `submitted *1 time entry*`, `manager` none.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: FAIL (HR's count stays at none).

- [ ] **Step 3: Implement the rule and pass `today` through**

In the unit spec, the `toHaveBeenCalledWith` assertions of `is counted and listed by the rule, a page at a time`, `is what Approve all approves, within what they may decide` and `tells each approver of the entries that wait for them` gain the `today` argument (`todayIso()`) and, for `findApproverIds`, `'told'`.

- [ ] **Step 4: Run everything that touches approvals**

Run: `pnpm test src/time-entries src/slack/tabs/approvals && pnpm test:int test/integration/away-approvers.int-spec.ts test/integration/time-approvals.int-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/time-entries test/integration/away-approvers.int-spec.ts
git commit -m "Send time entries to HR while every manager is away"
```

---

### Task 9: Telling HR on a manager's first day off

**Files:**
- Modify: `src/time-entries/services/time-entry-approvals.service.ts`
- Modify: `src/slack/tabs/approvals/services/time-entry-notifications.service.ts`
- Modify: `CLAUDE.md`
- Test: `test/integration/away-approvers.int-spec.ts`

**Interfaces:**
- Consumes: `ABSENCE_DAY_CHECKED`, `AbsenceDayCheckedEvent`, `AbsenceCheckService.checkWorkspace` (Task 6), `findApproverIds` (`'told'`) and `findSubmittedGroupApprovers` (`'listed'`/`'told'`) (Task 8), `onTimeOffText` (Task 7).
- Produces:
  - `export interface IMovedEntries { approver: IUserViewModel; groups: { teamName: string | null; away: { slackId: string; until: string }[]; count: number }[] }`
  - `TimeEntryApprovalsService.findMovedByAbsence(slackTeamId: string, date: string): Promise<IMovedEntries[]>`: the workspace's submitted entries whose listed approvers are all away on `date`, at least one with `since === date`, grouped by each of their `'told'` approvers who is not a listed one, then by team (names from `TeamsService`)
  - `PLAN_MOVED_JOB = 'time-entries-plan-moved'` with `{ slackTeamId: string; date: string }`: `@OnEvent(ABSENCE_DAY_CHECKED, { suppressErrors: false })` in `TimeEntryNotificationsService` only enqueues it in the claim's transaction (the claim makes it one per workspace and day); the plan runs `findMovedByAbsence` after the claim (by team and owner, `findSubmittedGroupApprovers`) and saves `NOTIFY_MOVED_JOB = 'time-entries-notify-moved'` with `{ slackTeamId: string; approverId: string; text: string }`, one per approver (`enqueueMany`); the job sends that text as one DM (review fix: the claim's transaction held the workspace's row through the whole read), a line per group: `${away}: ${count} time ${pluralize('entry', count)} of ${escapeMrkdwn(teamName)} now ${count === 1 ? 'waits' : 'wait'} for you in Approvals.` (`of people in no team` without a team)

- [ ] **Step 1: Write the failing integration test**

`tells HR once, on the manager's first day off`: a submitted entry of the member; manager's time off 2026-06-18..2026-06-24; `travelTo('2026-06-18')`; `checkWorkspace(workspace.id, '2026-06-18')`; `t.idle()`; HR's DMs are `[`<@${manager.slack_id}> is on time off until 24 Jun 2026: 1 time entry of Design now waits for you in Approvals.`]`; a second `checkWorkspace` the same day sends nothing; `travelTo('2026-06-19')` and `checkWorkspace(workspace.id, '2026-06-19')` sends nothing.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:int test/integration/away-approvers.int-spec.ts`
Expected: FAIL, HR got no DM.

- [ ] **Step 3: Implement `findMovedByAbsence`, the listener and the job**

- [ ] **Step 4: Update CLAUDE.md**

One sentence each where the flow is described: "Vacation request approval flow" (away approvers are skipped when a level starts and by the daily check, `planMoveOn`; a fallback level goes one above the highest), "Time & Billing" (what waits for whom while every manager is away), "Background jobs" (`SKIP_AWAY_JOB`, the daily check from 06:00 UTC claimed by `absence_check_date`).

- [ ] **Step 5: Run all tests**

Run: `npx tsc --noEmit && pnpm lint && pnpm test && pnpm test:int`
Expected: all PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/time-entries src/slack/tabs/approvals CLAUDE.md test/integration/away-approvers.int-spec.ts
git commit -m "Tell HR when time entries move to them for a manager's time off"
```
