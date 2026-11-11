import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from '@modules/request-workflows/types/request-workflow-step.interface';

// The tab's notice after a decision made once Slack had its answer: the
// decision's first run may have found the step decided by someone else, or
// failed and be tried again, and the notice says so instead of `done`.
export const decisionNotice = (
  step: IRequestWorkflowStepViewModel | null,
  decider: { slack_id: string },
  status: WorkflowStepStatus.Approved | WorkflowStepStatus.Rejected,
  done: string,
): string => {
  const data = step?.step_data;

  if (!data) {
    return 'Not decided: the request was deleted meanwhile.';
  }

  if (data.status === WorkflowStepStatus.Pending) {
    return '⏳ Not decided yet: it will be tried again in a few minutes.';
  }

  if (data.status === status && data.decided_by_slack_id === decider.slack_id) {
    return done;
  }

  if (
    data.status === WorkflowStepStatus.Cancelled ||
    !data.decided_by_slack_id
  ) {
    return 'Not decided: the request was changed or canceled meanwhile.';
  }

  // The notice is plain text, where a mention shows as typed.
  return `Not decided: someone else ${data.status === WorkflowStepStatus.Approved ? 'approved' : 'rejected'} it first.`;
};
