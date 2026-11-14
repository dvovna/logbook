import { decisionNotice } from 'src/slack/approvals/utils/decision-notice';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from 'src/request-workflows/types/request-workflow-step.interface';

const stepWith = (
  status: WorkflowStepStatus,
  decidedBy?: string,
): IRequestWorkflowStepViewModel =>
  ({
    step_data: { status, decided_by_slack_id: decidedBy },
  }) as IRequestWorkflowStepViewModel;

const me = { slack_id: 'U_ME' };
const notice = (step: IRequestWorkflowStepViewModel | null) =>
  decisionNotice(step, me, WorkflowStepStatus.Approved, '✅ Approved.');

describe('decisionNotice', () => {
  it('says done when the decision is theirs', () => {
    expect(notice(stepWith(WorkflowStepStatus.Approved, 'U_ME'))).toBe(
      '✅ Approved.',
    );
  });

  it('names who decided first', () => {
    expect(notice(stepWith(WorkflowStepStatus.Rejected, 'U_OTHER'))).toBe(
      'Not decided: someone else rejected it first.',
    );
    expect(notice(stepWith(WorkflowStepStatus.Approved, 'U_OTHER'))).toBe(
      'Not decided: someone else approved it first.',
    );
  });

  it('says it will be tried again when the decision failed', () => {
    expect(notice(stepWith(WorkflowStepStatus.Pending))).toBe(
      '⏳ Not decided yet: it will be tried again in a few minutes.',
    );
  });

  it('says the request changed or went', () => {
    expect(notice(stepWith(WorkflowStepStatus.Cancelled, 'U_HR'))).toBe(
      'Not decided: the request was changed or canceled meanwhile.',
    );
    expect(notice(null)).toBe(
      'Not decided: the request was deleted meanwhile.',
    );
  });

  it('says the request went on without the approver while they are on time off', () => {
    expect(notice(stepWith(WorkflowStepStatus.Skipped))).toBe(
      'Not decided: it went on without you while you are on time off.',
    );
  });
});
