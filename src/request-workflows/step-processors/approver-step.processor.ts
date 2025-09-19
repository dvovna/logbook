import { Injectable, Logger } from '@nestjs/common';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepProcessor } from 'src/request-workflows/types/workflow-step-handler.interface';
import { WorkflowStepProcessor } from 'src/request-workflows/decorators/workflow-step-handler.decorator';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ApproverMessageActionId } from 'src/request-workflows/enums/approver-message-action-id.enum';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';

@Injectable()
@WorkflowStepProcessor(WorkflowStepType.Approver)
export class ApproverStepProcessor implements IWorkflowStepProcessor {
  private readonly logger = new Logger(ApproverStepProcessor.name);

  public constructor(
    private readonly communicationService: SlackCommunicationService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
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
            text: `⏳ Vacation request for ${step.step_data.snapshot.user_name}

📅 ${step.step_data.snapshot.start_date} → ${step.step_data.snapshot.end_date} (${step.step_data.snapshot.days} days, ${step.step_data.snapshot.working_days} working days)
🏖️ ${VACATION_TYPE_DISPLAY_NAME_MAP[step.step_data.snapshot.type]}
${step.step_data.snapshot.comment ? `💬 Comment: ${step.step_data.snapshot.comment}` : ''}

⚡ Needs your approval`,
          },
        },
        {
          type: 'actions',
          block_id: ViewCallbackId.WorkflowStepMessage,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve ✅' },
              style: 'primary',
              action_id: ApproverMessageActionId.Approve,
              value: `${ApproverMessageActionId.Approve}:${step.id}`,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject ❌' },
              style: 'danger',
              action_id: ApproverMessageActionId.Reject,
              value: `${ApproverMessageActionId.Reject}:${step.id}`,
            },
          ],
        },
      ],
    };

    const { channel, ts } = await this.communicationService.postMessage(
      step.slack_user_id,
      message,
      step.slack_team_id,
    );

    if (channel && ts) {
      await this.requestWorkflowStepsService.update(
        {
          id: step.id,
          slackTeamId: step.slack_team_id,
        },
        {
          slackMessageTs: ts,
          slackChannelId: channel,
        },
      );
    }
  }

  public async complete(step: IRequestWorkflowStepViewModel): Promise<void> {
    if (!step.slack_message_ts || !step.slack_channel_id) {
      this.logger.error('Step message timestamp or channel are missing');
      return;
    }

    await this.communicationService.updateMessage(
      step.slack_channel_id,
      step.slack_message_ts,
      step.step_data.status === 'approved'
        ? this.getApprovedMessage(step)
        : this.getRejectedMessage(step),
      step.slack_team_id,
    );

    await this.requestWorkflowStepsService.update(
      {
        id: step.id,
        slackTeamId: step.slack_team_id,
      },
      {
        completedAt: new Date().toISOString(),
      },
    );
  }

  private getApprovedMessage(step: IRequestWorkflowStepViewModel) {
    return {
      text: '✅ Vacation request approved',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Approved by <@${step.step_data.decided_by_slack_id}>

${this.getRequestDetails(step)}`,
          },
        },
      ],
    };
  }

  private getRejectedMessage(step: IRequestWorkflowStepViewModel) {
    return {
      text: '❌ Vacation request rejected',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ Rejected by <@${step.step_data.decided_by_slack_id}>

${this.getRequestDetails(step)}`,
          },
        },
      ],
    };
  }

  private getRequestDetails(step: IRequestWorkflowStepViewModel) {
    return `
*Request details:*

👤 Employee: ${step.step_data.snapshot.user_name}
📅 Dates: ${step.step_data.snapshot.start_date} → ${step.step_data.snapshot.end_date} (${step.step_data.snapshot.days} calendar days, ${step.step_data.snapshot.working_days} working days)
🏖️ Type: ${VACATION_TYPE_DISPLAY_NAME_MAP[step.step_data.snapshot.type]}
${step.step_data.snapshot.comment ? `💬 Comment: ${step.step_data.snapshot.comment}` : ''}
`;
  }
}
