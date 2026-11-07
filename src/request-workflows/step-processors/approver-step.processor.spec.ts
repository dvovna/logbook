import { ApproverStepProcessor } from 'src/request-workflows/step-processors/approver-step.processor';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import VacationType from 'src/common/enums/vacation-type.enum';

const buildStep = (
  status: WorkflowStepStatus,
  overrides: Partial<IRequestWorkflowStepViewModel> = {},
): IRequestWorkflowStepViewModel => ({
  id: 'step-1',
  slack_team_id: 'slack-team-1',
  request_id: 'request-1',
  slack_user_id: 'U_APPROVER',
  slack_channel_id: 'D_APPROVER',
  slack_message_ts: '1700000000.000100',
  step_level: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  step_type: WorkflowStepType.Approver,
  step_data: {
    status,
    rule: ApprovalRule.Any,
    decided_by_slack_id: 'U_REQUESTER',
    snapshot: {
      user_id: 'user-1',
      slack_user_id: 'U_REQUESTER',
      user_name: 'Requester',
      user_email: 'requester@example.com',
      start_date: '2026-02-02',
      end_date: '2026-02-06',
      days: 5,
      working_days: 5,
      type: VacationType.AnnualLeave,
      comment: '',
    },
  },
  ...overrides,
});

describe('ApproverStepProcessor', () => {
  let communicationService: { updateMessage: jest.Mock };
  let stepsService: { update: jest.Mock };
  let processor: ApproverStepProcessor;

  beforeEach(() => {
    communicationService = { updateMessage: jest.fn() };
    stepsService = { update: jest.fn() };

    processor = new ApproverStepProcessor(
      communicationService as unknown as SlackCommunicationService,
      stepsService as unknown as RequestWorkflowStepsService,
    );
  });

  it('replaces the buttons with a canceled note when the request is canceled', async () => {
    await processor.updateMessage(buildStep(WorkflowStepStatus.Cancelled), []);

    const [channel, ts, message] = communicationService.updateMessage.mock
      .calls[0] as [string, string, { text: string; blocks: object[] }];

    expect(channel).toBe('D_APPROVER');
    expect(ts).toBe('1700000000.000100');
    expect(message.text).toBe('❌ Vacation request canceled');
    expect(JSON.stringify(message.blocks)).toContain(
      'Canceled by <@U_REQUESTER>',
    );
    expect(message.blocks).not.toContainEqual(
      expect.objectContaining({ type: 'actions' }),
    );
  });
});
