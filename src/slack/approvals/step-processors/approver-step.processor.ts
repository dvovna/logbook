import { WorkflowStepStatus } from '@modules/request-workflows/types/request-workflow-step.interface';
import { IApprovalProgress } from '@modules/slack/approvals/views/approver-message.view';
import { Injectable, Logger } from '@nestjs/common';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepProcessor } from '@modules/request-workflows/types/workflow-step-handler.interface';
import { WorkflowStepProcessor } from '@modules/request-workflows/decorators/workflow-step-handler.decorator';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { ApproverMessageView } from '@modules/slack/approvals/views/approver-message.view';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import { runOf } from '@modules/request-workflows/utils/workflow-runs';

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
      ApproverMessageView.getMessage({
        step,
        comments,
        progress: await this.findProgress(step),
      }),
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

  public async updateMessage(
    step: IRequestWorkflowStepViewModel,
    comments?: IWorkflowStepCommentViewModel[],
    requestDeleted?: boolean,
  ): Promise<void> {
    if (!step.slack_message_ts || !step.slack_channel_id) {
      this.logger.error(`Step ${step.id} has no message to update`);
      return;
    }

    await this.communicationService.updateMessage(
      step.slack_channel_id,
      step.slack_message_ts,
      ApproverMessageView.getMessage({
        step,
        comments,
        progress: await this.findProgress(step),
        requestDeleted,
        wentOnTo:
          step.step_data.status === WorkflowStepStatus.Skipped
            ? await this.findLevelWentOnTo(step)
            : undefined,
      }),
      step.slack_team_id,
    );
  }

  // The name of the next level the request went on to after this step was
  // skipped: the lowest level above it, in its run, that was asked. Nothing
  // when another approver of the same level still decides.
  private async findLevelWentOnTo(
    step: IRequestWorkflowStepViewModel,
  ): Promise<string | undefined> {
    const steps = (
      await this.requestWorkflowStepsService.findMany({
        requestId: step.request_id,
        slackTeamId: step.slack_team_id,
      })
    ).filter(
      (other) =>
        runOf(other) === runOf(step) &&
        other.step_level > step.step_level &&
        !!other.processed_at,
    );

    if (!steps.length) {
      return undefined;
    }

    const next = steps.reduce((lowest, other) =>
      other.step_level < lowest.step_level ? other : lowest,
    );

    return next.step_data.level_name ?? `Level ${next.step_level}`;
  }

  // Where the request stands: the step's level of how many, and who approved
  // the levels before it.
  private async findProgress(
    step: IRequestWorkflowStepViewModel,
  ): Promise<IApprovalProgress | undefined> {
    // Only a message still waiting for a decision shows it.
    if (step.step_data.status !== WorkflowStepStatus.Pending) {
      return undefined;
    }

    const steps = (
      await this.requestWorkflowStepsService.findMany({
        requestId: step.request_id,
        slackTeamId: step.slack_team_id,
      })
    ).filter((other) => runOf(other) === runOf(step));
    const approvedBy = steps
      .filter(
        ({ step_level, step_data }) =>
          step_level < step.step_level &&
          step_data.status === WorkflowStepStatus.Approved,
      )
      .map(
        ({ step_data, slack_user_id }) =>
          step_data.decided_by_slack_id ?? slack_user_id,
      )
      .filter((slackId): slackId is string => !!slackId);

    const skipped = steps
      .filter(
        ({ step_level, step_data }) =>
          step_level < step.step_level &&
          step_data.status === WorkflowStepStatus.Skipped &&
          !!step_data.away_until,
      )
      .map(({ slack_user_id, step_data }) => ({
        slackId: slack_user_id,
        until: step_data.away_until!,
      }));

    return {
      level: step.step_level,
      levels: Math.max(step.step_level, ...steps.map((s) => s.step_level)),
      approvedBy: [...new Set(approvedBy)],
      skipped,
    };
  }
}
