import { Injectable } from '@nestjs/common';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepProcessor } from 'src/request-workflows/types/workflow-step-handler.interface';
import { WorkflowStepProcessor } from 'src/request-workflows/decorators/workflow-step-handler.decorator';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

@Injectable()
@WorkflowStepProcessor(WorkflowStepType.Approver)
export class ApproverStepProcessor implements IWorkflowStepProcessor {
  public constructor(
    private readonly communicationService: SlackCommunicationService,
  ) {}

  public supports(step: IRequestWorkflowStepViewModel): boolean {
    return step.step_type === WorkflowStepType.Approver;
  }

  public async process(step: IRequestWorkflowStepViewModel): Promise<void> {
    const message = {
      text: `:wave: You have a new vacation request to approve.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Vacation request for ${step.step_data.snapshot.user_name} (${step.step_data.snapshot.start_date} → ${step.step_data.snapshot.end_date}) needs your approval.`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve ✅' },
              style: 'primary',
              value: JSON.stringify({ stepId: step.id, action: 'approve' }),
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject ❌' },
              style: 'danger',
              value: JSON.stringify({ stepId: step.id, action: 'reject' }),
            },
          ],
        },
      ],
    };

    await this.communicationService.postEphemeral(
      step.slack_user_id,
      message,
      step.slack_team_id,
    );
  }
}
