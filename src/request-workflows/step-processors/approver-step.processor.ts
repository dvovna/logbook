import { Injectable, Logger } from '@nestjs/common';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepProcessor } from 'src/request-workflows/types/workflow-step-handler.interface';
import { WorkflowStepProcessor } from 'src/request-workflows/decorators/workflow-step-handler.decorator';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { ApproverMessageView } from 'src/request-workflows/views/approver-message.view';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';

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

  public async process(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void> {
    const { channel, ts } = await this.communicationService.postMessage(
      step.slack_user_id,
      ApproverMessageView.getMessage({ step, comments }),
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
          processedAt: new Date().toISOString(),
        },
      );
    }
  }

  public async complete(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void> {
    await this.updateMessage(step, comments);

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

  public async updateMessage(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void> {
    if (!step.slack_message_ts || !step.slack_channel_id) {
      this.logger.error('Step message timestamp or channel are missing');
      return;
    }

    await this.communicationService.updateMessage(
      step.slack_channel_id,
      step.slack_message_ts,
      ApproverMessageView.getMessage({ step, comments }),
      step.slack_team_id,
    );
  }
}
