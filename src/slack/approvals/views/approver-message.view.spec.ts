import { ApproverMessageView } from '@modules/slack/approvals/views/approver-message.view';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from '@modules/request-workflows/types/request-workflow-step.interface';

const skippedStep = {
  id: 'step-1',
  slack_user_id: 'U_A',
  step_data: {
    status: WorkflowStepStatus.Skipped,
    skip_reason: 'time_off',
    away_until: '2026-06-24',
    snapshot: {
      user_name: 'Mia',
      start_date: '2026-07-01',
      end_date: '2026-07-05',
      days: 5,
      working_days: 3,
      type: 'vacation',
      comment: '',
    },
  },
} as unknown as IRequestWorkflowStepViewModel;

describe('ApproverMessageView', () => {
  it('shows a skipped step without buttons, and where the request went', () => {
    const message = ApproverMessageView.getMessage({
      step: skippedStep,
      wentOnTo: 'HR approval',
    });

    expect(JSON.stringify(message)).toContain(
      "⏭️ Skipped while you're on time off (until 24 Jun 2026). It went on to HR approval.",
    );
    expect(message.blocks.some((block) => block.type === 'actions')).toBe(
      false,
    );
  });

  it('leaves out where it went when no other level was asked', () => {
    expect(
      JSON.stringify(ApproverMessageView.getMessage({ step: skippedStep })),
    ).toContain("⏭️ Skipped while you're on time off (until 24 Jun 2026).\\n");
  });
});
