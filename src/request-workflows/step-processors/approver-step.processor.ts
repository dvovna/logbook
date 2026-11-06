import { Injectable, Logger } from '@nestjs/common';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepProcessor } from '@modules/request-workflows/types/workflow-step-handler.interface';
import { WorkflowStepProcessor } from '@modules/request-workflows/decorators/workflow-step-handler.decorator';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { ApproverMessageView } from '@modules/request-workflows/views/approver-message.view';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

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

  public async processPending(
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

  public async processCompleted(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void> {
    // Steps of a level that was never reached have no message to update.
    if (step.slack_message_ts) {
      await this.updateMessage(step, comments);
    }

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

  public async processCanceled(
    step: IRequestWorkflowStepViewModel,
  ): Promise<void> {
    await this.updateMessage(step);

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
    comments?: IWorkflowStepCommentViewModel[],
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
