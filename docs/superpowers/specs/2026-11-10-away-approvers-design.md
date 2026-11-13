# Approvers who are away

Issue: dvovna/logbook#66.

## Why

Today the approval flow ignores time off. A vacation request goes to the approvers its team lists (`manager_approvers`, then `hr_approvers`; `VacationRequestProcessingService.startWorkflow`), whether they are at work or not, and waits for them. With one manager, or with the ALL rule, a request whose manager is on vacation waits until the manager comes back, or until HR or an admin notices it and uses "Approve for Approvers" (`RequestWorkflowService.approveCurrentLevel`). Nobody is told that it is stuck. Submitted time entries wait for their team's managers the same way (`TimeEntryApprovalsService.findApprovers`).

The bot hasn't run anywhere yet; the user designed this case ahead. In the user's own team, when the manager is away, another manager of the team decides, or the user goes to leadership, which in Logbook is an admin.

Success: a request never waits for someone who is on time off. It goes on to the next person in line, the requester knows why, and a person always makes the final decision.

## Goals

1. **Away means approved time off today.** An approver is away when they have an approved vacation request of any type (sick leave included) whose dates include today.
2. **Away approvers are skipped when a request reaches them.** When a level of a vacation workflow starts (the first level when the request is made, the next one when a level is done), its away approvers are not asked; their steps are marked skipped.
3. **Approvers who go away while a request waits for them are skipped too.** A daily check, and a check when someone's time off covering today is approved, skip the open steps of the current level whose approver is away.
4. **The request goes on along the flow.** A level with nobody left to ask is skipped and the next level decides. When the last level would be skipped, the request goes to the fallback approvers instead (everyone with the HR role, else the admins, as today when a team has no approvers), without the away ones. A request is never approved by skips alone.
5. **People see what happened.** A skipped step says so ("Skipped: on time off until 24 Nov") in the request's Details timeline and in the approver's message if they had one; the requester is told when the request goes to someone else because of it.
6. **Time entries follow the same rule.** A manager who is away is not one of an entry's approvers; when every manager of the team is away, the entry waits for HR (else the admins), and goes back to the managers when they return.

## Non-goals

- Deputies that people set up ("Olga decides for me while I'm away").
- Escalation of requests that wait too long for an approver who is at work.
- Reminders to approvers.
- A hierarchy above team managers other than HR and admins.
- Giving a skipped step back to an approver who returns before the request is decided.
- Pending time off of the approver: only approved time off counts.
- Approvers who are away on the request's dates but at work today: the decision is needed now.
- Deactivated approvers in vacation workflows (time entries already leave them out): a separate fix.
- Per-person time zones: "today" is the UTC date, as everywhere in the app.

## Anti-goals (a failure even if it works)

- A request approved without any person approving its last level.
- A request that waits with nobody asked, or that goes to its own requester.
- A step shown as approved by someone who approved nothing.
- Skipping someone who is not away (wrong dates, wrong time zone, pending time off counted).
- Two outcomes from one moment: an approver who clicks Approve as their step is skipped must not lead to the next level being asked twice or the request finished twice.
- The same notice twice to the requester or to HR (a restart, a second run of the check).

## Constraints

- Decisions on a workflow are one transaction: the advisory lock `workflow:<request id>`, then `RequestWorkflowStepsRepository.decide`, which changes only open steps and returns the ones it changed (none when someone else was first). The next level is claimed with `claimUnprocessed`. Slack messages are jobs enqueued in the same transaction; events that must be saved with the decision go through `emitAsync`. A skip is a decision and follows the same pattern.
- Domain code (`request-workflows`, `vacation-requests`, `time-entries`) does not import `src/slack`; a change people should hear about is an event, and a listener in `src/slack` sends the messages.
- Job handlers load current data and are safe to run twice.
- `step_data` is jsonb with no check on `status`: a new step status needs no migration. A new column does (migration, `pnpm db:types`).
- Labels and icons of statuses live in `src/slack/common/views/data/labels.ts`.
- Integration tests start at `TEST_NOW` (Wednesday 2026-06-17) and move with `travelTo`; every flow gets one, including what a role may not do.

## Decisions

### Who is away

- An approver is away on a date when one of their vacation requests with status approved has `start_date <= date <= end_date`. Any type counts. A weekend or holiday inside the request counts as away; a day outside every approved request does not.
- "Until" in the texts is the `end_date` of the approved request that covers today *(my call: adjacent requests are not chained)*.
- One domain helper answers "who of these people is away on this date, and until when" for a workspace, from `VacationRequestsService.findMany` (`statuses: [Approved]`, `overlapping: { startDate: date, endDate: date }`). The vacation workflow and the time entry approvals both use it. Where it lives is left to the builder, within the domain modules.

### The rule

Applied when a level starts, and by the check to the level a request is waiting on:

1. The away approvers' open steps of that level are marked **skipped**.
2. If the level still has open steps, it waits for them (ANY: any one of them approves; ALL: all of them).
3. If no open step is left:
   - the level had at least one approval: it is done, and the next level starts (as when the last approver of a level approves);
   - every step of the level was skipped: the level is skipped, and the next level starts;
   - there is no next level, and the last level was skipped: a **fallback level** is added after it and started: everyone with the HR role who is active, not the requester and not away; when that leaves nobody, every such admin. ANY rule, named "HR approval" or "Admin approval" as today. *(Builder-check call: someone who decided an earlier level of the same request, e.g. HR with "Approve for Approvers", may be in the fallback level, as today one person may be listed in both of a team's levels.)*
   - there is no next level, and the last level had an approval: the request is approved, as today, by that approval. Under ALL this means: A approved, B goes away, the request is approved by A *(decided with the user: the away approver's step is skipped and, when the others already approved, the level is done)*.
4. **Nobody is skipped for nobody.** A skip that would leave the request waiting only for people who are away is not made: when everyone who could take it is away too, nothing changes and the request waits for the approver it waits for now, as today. A skip that completes a level which has an approval is made (point 3). *(My call: it replaces the earlier idea of sending it to all the fallback approvers anyway. Both wait for someone away; this one changes nothing and cannot loop.)*

Levels that haven't started are not judged early: an HR approver who is away today but back by the time the manager approves is asked as usual.

When the request is made and the team has no approvers at all (or only the requester), it goes to the fallback approvers as today, without the away ones, with point 4 applying (if every fallback approver is away, they are all asked).

### Making a request

`startWorkflow` creates the steps of every level as today, then starts level 1 by the rule. So level 1 may end up skipped at once, with level 2 (or the fallback level) asked instead. Code that assumes level 1 is the first asked level (`RequestWorkflowService.create` re-asking level 1 on a retry, `getSentToText` reading level 1) changes to "the first level with someone asked".

### The check while a request waits

- **Daily**, once per workspace, from 06:00 UTC *(my call on the hour)*: a workspace claims the day before it runs (`slack_teams.absence_check_date`, a new date column, as `time_reminder_week` does for reminders), so a restart or a second tick runs nothing twice. Each request with an open step of an away approver is a job; the skip itself is safe to repeat (it changes only open steps).
- **When time off becomes approved** and covers today (the workflow approves it, HR or an admin creates it approved, edits it into approved, or edits an approved one so that it covers today): the same check runs at once for that person's open steps, so a manager whose same-day time off is approved at 10:00 is skipped at once rather than the next morning. *(Builder-check call: a CSV import of vacations doesn't run it; the next daily check does.)*
- A skip is one transaction under `workflow:<request id>` with the conditional update; an approver who clicks at the same moment either wins (the skip then changes nothing) or finds the step already closed (as with any decision someone else made first).

### Data

- `WorkflowStepStatus.Skipped = 'skipped'` (and the matching `RequestWorkflowStatus` value `decide` takes).
- A skipped step's `step_data` gets `status: 'skipped'`, `decided_at`, no `decided_by_slack_id` (nobody decided), and `skip_reason: 'time_off'` with `away_until: 'YYYY-MM-DD'`.
- A fallback level added mid-flow is new step rows with `step_level` one above the highest.
- `slack_teams.absence_check_date date`, null until the first check.

### What people see

- **Details timeline:** the skipped approver with "⏭️ Skipped · on time off until 24 Nov" (label and icon in `STEP_STATUS_LABELS`).
- **The skipped approver's message**, if they had one: updated without buttons, "⏭️ Skipped while you're on time off (until 24 Nov). It went on to HR approval." No message for a step that was never asked.
- **Requester, when the request is made:** the "went to" DM names who is away and why it went elsewhere: "Ivan is on time off until 24 Nov, so your request went to HR approval: @Olga."
- **Requester, while it waits:** a DM when a skip makes the request wait for people who weren't asked before (the next level, or the fallback level): "Ivan is on time off until 24 Nov. Your request now waits for HR approval from @Olga." No DM when it only stops waiting for one of several people already asked (ANY with another manager at work, ALL with the others still to approve).
- **The new approvers** get the usual approver DM; its context line, which names who approved earlier levels, also says that a level was skipped and why.
- **"Approve for Approvers"** works as today on the level the request waits on; skipped steps are closed and play no part.

### Time entries

- Two questions are kept apart *(builder-check call)*: **whose inbox an entry is in**, and **who is told**. An entry stays in its managers' inboxes, the away ones' too (a Manager's inbox is scoped by team; an Admin or HR person listed as a team's manager keeps the team's entries in theirs as well, though `findWaitingForAdmin` reads `findApprovers` today). When every manager of the entry's team is away, the entry is also in the inbox of the fallback approvers who are not away (HR, else admins). When nobody who could decide is at work, nothing changes and the entry waits for its managers, as point 4 above.
- This is worked out on every read, as today, so HR's inbox, its count and "Approve all" pick the entries up while the managers are away, and they leave HR's inbox when the time off ends, if nobody decided them. The away manager may still decide them.
- Submitting notifies the approvers who are at work (`groupByApprover` uses the same rule).
- **Notice:** the daily check tells the new approvers, in one DM each, about the submitted entries that move to them because a manager's time off starts that day: "Ivan is on time off until 24 Nov: 6 time entries of Design now wait for you in Approvals." *(My call: only on the day the time off starts, from the claimed daily check, so it is never sent twice; time off approved later than that moves the entries without a notice.)*

## Tests

Unit tests for the rule as a function of the levels, their steps and who is away. Integration tests (`test/integration`, approved vacations as fixtures, `travelTo` to move into someone's time off), at least:

1. ANY with two managers, one away when the request is made: only the other is asked; the away one's step is skipped; the requester's DM says so.
2. The only manager away when the request is made, team with an HR level: HR is asked first.
3. The only manager away, no HR level: the fallback (HR role, else admins) is asked.
4. ALL with two managers, one away: the request waits for the other one only, and their approval completes the level.
5. The request waits for the manager; `travelTo` the manager's first day off; the check skips the step, asks HR, updates the manager's message and tells the requester; a second run changes nothing.
6. The manager approved, the only HR approver goes away: the fallback level is asked, the request is not approved.
7. Everyone who could decide is away: nothing is skipped.
8. Time off approved the same day it starts: the step is skipped at once.
9. Pending time off doesn't count; sick leave does.
10. An approver approves while the check skips their step: one outcome, the next level asked once.
11. "Approve for Approvers" on a level with skipped steps.
12. Time entries: the manager away, the entry shows in HR's inbox and count; the manager back, it leaves HR's inbox; the notice is sent once on the first day off.

## Left to the builder

- Names and placement of the absence helper, the rule function and the check service, within the module boundaries above.
- Exact message wording, within the meaning above.
- How the skip path passes "no user" through code that takes a deciding user today (`activateNextLevel`, `finishWorkflow`'s `approvedBy`), and which approval counts as the request's `approvedBy` when the last level had several under ALL.
- Code that assumes the next asked level is `level + 1` (the level-completed DM, "Level N of M" in the approver's message) once levels can be skipped and a fallback level added.
- How the integration tests run the daily check (a method the test calls, as `TimeEntryRemindersService.remindAll`).
