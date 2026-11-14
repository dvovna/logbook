import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { planMoveOn } from '@modules/request-workflows/utils/move-on-plan';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IAbsence } from '@modules/users/types/absence.interface';
import VacationType from '@common/enums/vacation-type.enum';

const step = (
  id: string,
  slackUserId: string,
  level: number,
): IRequestWorkflowStepViewModel => ({
  id,
  slack_team_id: 'team',
  request_id: 'request',
  slack_user_id: slackUserId,
  step_level: level,
  created_at: '2026-06-17T00:00:00.000000+00:00',
  updated_at: '2026-06-17T00:00:00.000000+00:00',
  completed_at: null,
  step_type: WorkflowStepType.Approver,
  step_data: {
    status: WorkflowStepStatus.Pending,
    rule: ApprovalRule.Any,
    snapshot: {
      user_id: 'requester',
      slack_user_id: 'U_R',
      user_name: 'Requester',
      user_email: 'r@example.com',
      start_date: '2026-06-18',
      end_date: '2026-06-19',
      days: 2,
      working_days: 2,
      type: VacationType.AnnualLeave,
      comment: '',
    },
  },
});

const approved = (
  s: IRequestWorkflowStepViewModel,
  by: string = s.slack_user_id,
): IRequestWorkflowStepViewModel => ({
  ...s,
  completed_at: '2026-06-17T01:00:00.000000+00:00',
  step_data: {
    ...s.step_data,
    status: WorkflowStepStatus.Approved,
    decided_by_slack_id: by,
  },
});

const canceled = (
  s: IRequestWorkflowStepViewModel,
): IRequestWorkflowStepViewModel => ({
  ...s,
  completed_at: '2026-06-17T01:00:00.000000+00:00',
  step_data: { ...s.step_data, status: WorkflowStepStatus.Cancelled },
});

const skipped = (
  s: IRequestWorkflowStepViewModel,
): IRequestWorkflowStepViewModel => ({
  ...s,
  completed_at: '2026-06-17T01:00:00.000000+00:00',
  step_data: {
    ...s.step_data,
    status: WorkflowStepStatus.Skipped,
    skip_reason: 'time_off',
    away_until: '2026-06-24',
  },
});

const all = (
  s: IRequestWorkflowStepViewModel,
): IRequestWorkflowStepViewModel => ({
  ...s,
  step_data: { ...s.step_data, rule: ApprovalRule.All },
});

describe('planMoveOn', () => {
  const away = new Map<string, IAbsence>([
    ['U_A', { userId: 'user-a', since: '2026-06-15', until: '2026-06-24' }],
  ]);
  const a1 = step('a1', 'U_A', 1);
  const a2 = step('a2', 'U_A', 2);
  const b1 = step('b1', 'U_B', 1);
  const h2 = step('h2', 'U_H', 2);
  const h3 = step('h3', 'U_H', 3);
  const x1 = step('x1', 'U_X', 1);
  const x2 = step('x2', 'U_X', 2);

  const plan = (
    steps: IRequestWorkflowStepViewModel[],
    waitingOn: number | null,
    fallbackAtWork: boolean,
  ) => planMoveOn({ steps, waitingOn, away, fallbackAtWork });

  it('asks level 1 of a new request when nobody is away', () => {
    expect(plan([b1, h2], null, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'ask', level: 1, after: null },
    });
  });

  it('skips the away approver and asks the one at work', () => {
    expect(plan([a1, b1], null, false)).toEqual({
      approveAs: [],
      skip: [a1],
      next: { kind: 'ask', level: 1, after: null },
    });
  });

  it('skips a level whose approvers are all away and asks the next', () => {
    expect(plan([a1, h2], null, false)).toEqual({
      approveAs: [],
      skip: [a1],
      next: { kind: 'ask', level: 2, after: null },
    });
  });

  it('falls back when the last level would be skipped', () => {
    expect(plan([a1], null, true)).toEqual({
      approveAs: [],
      skip: [a1],
      next: { kind: 'fallback', after: null },
    });
  });

  it('skips one person listed in both levels and falls back', () => {
    expect(plan([a1, a2], null, true)).toEqual({
      approveAs: [],
      skip: [a1, a2],
      next: { kind: 'fallback', after: null },
    });
  });

  it('changes nothing when nobody who could decide is at work', () => {
    expect(plan([a1, a2], null, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'ask', level: 1, after: null },
    });
  });

  it('keeps waiting for the approver at work', () => {
    expect(plan([a1, b1], 1, false)).toEqual({
      approveAs: [],
      skip: [a1],
      next: { kind: 'wait' },
    });
  });

  it('completes an ALL level that has an approval when the rest are away', () => {
    expect(plan([all(approved(b1)), all(a1)], 1, false)).toEqual({
      approveAs: [],
      skip: [all(a1)],
      next: { kind: 'approve', level: 1 },
    });
  });

  it('moves on to the next level after an approval', () => {
    expect(plan([approved(b1), h2], 1, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'ask', level: 2, after: 1 },
    });
  });

  it('falls back instead of approving when the last level is skipped', () => {
    expect(plan([approved(b1), a2], 2, true)).toEqual({
      approveAs: [],
      skip: [a2],
      next: { kind: 'fallback', after: 2 },
    });
  });

  it('changes nothing while it waits when everyone who could decide is away', () => {
    expect(plan([a1, a2], 1, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'wait' },
    });
  });

  it('approves for someone who approved this run already (#90)', () => {
    expect(plan([approved(x1), x2, h3], 1, false)).toEqual({
      approveAs: [x2],
      skip: [],
      next: { kind: 'ask', level: 3, after: 2 },
    });
  });

  it('leaves the others of an ALL level to decide (#90)', () => {
    expect(plan([approved(x1), all(x2), all(h2)], 1, false)).toEqual({
      approveAs: [all(x2)],
      skip: [],
      next: { kind: 'ask', level: 2, after: 1 },
    });
  });

  it('approves when #90 completes the last level', () => {
    expect(plan([approved(x1), x2], 1, false)).toEqual({
      approveAs: [x2],
      skip: [],
      next: { kind: 'approve', level: 2 },
    });
  });

  it('asks the next level, away or not, when a dropped approver empties the level and nobody is at work', () => {
    expect(plan([canceled(b1), a2], 1, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'ask', level: 2, after: 1 },
    });
  });

  it('falls back when a dropped approver empties the last level', () => {
    expect(plan([canceled(b1)], 1, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'fallback', after: 1 },
    });
  });

  // A request is never approved without a person's approval.
  it('falls back instead of approving when there is no level to look at', () => {
    expect(plan([], null, true)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'fallback', after: null },
    });
    expect(plan([canceled(b1)], null, false)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'fallback', after: null },
    });
  });

  it('approves when #90 closes an ANY level that also has someone at work', () => {
    expect(plan([approved(x1), x2, h2], 1, false)).toEqual({
      approveAs: [x2],
      skip: [],
      next: { kind: 'approve', level: 2 },
    });
  });

  it('approves when #90 leaves only away people on the last ALL level', () => {
    expect(plan([approved(x1), all(x2), all(a2)], 1, false)).toEqual({
      approveAs: [all(x2)],
      skip: [all(a2)],
      next: { kind: 'approve', level: 2 },
    });
  });

  it('keeps waiting for the one at work after an earlier skip', () => {
    expect(plan([skipped(a1), b1, h2], 1, true)).toEqual({
      approveAs: [],
      skip: [],
      next: { kind: 'wait' },
    });
  });
});
