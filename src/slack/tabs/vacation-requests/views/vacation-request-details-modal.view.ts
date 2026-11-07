import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { AnyBlock } from '@slack/web-api';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import capitalize from '@common/utils/capitalize';

const STEP_STATUS_EMOJI: Record<WorkflowStepStatus, string> = {
  [WorkflowStepStatus.Pending]: '⏳',
  [WorkflowStepStatus.Approved]: '✅',
  [WorkflowStepStatus.Rejected]: '❌',
  [WorkflowStepStatus.Cancelled]: '🚫',
};

interface IGetParams extends IBaseModalViewParams {
  request: IVacationRequestViewModel;
  steps: IRequestWorkflowStepViewModel[];
  reviewComments: IWorkflowStepCommentViewModel[];
}

@Injectable()
export class VacationRequestDetailsModalView extends BaseModalView<IGetParams> {
  protected defaultCallbackId = ViewCallbackId.ViewVacationRequestDetails;

  protected getTitleText() {
    return 'Vacation Request Details';
  }

  protected getActionButtons(): IActionButtons {
    return {
      close: { type: 'plain_text', text: 'Close' },
    };
  }

  protected getViewBlocks({
    request,
    steps,
    reviewComments,
  }: IGetParams): AnyBlock[] {
    const blocks: AnyBlock[] = [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Requester:* ${request.user!.name} (<@${request.user!.slack_id}>)`,
          },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `📅 *Dates:*\n${request.start_date} → ${request.end_date}`,
          },
          {
            type: 'mrkdwn',
            text: `🏖️ *Type:*\n${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]}`,
          },
          {
            type: 'mrkdwn',
            text: `📊 *Days:*\n${request.days} (${request.working_days} working)`,
          },
          {
            type: 'mrkdwn',
            text: `📌 *Status:*\n${capitalize(request.status)}`,
          },
        ],
      },
    ];

    if (request.user_comment) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 *User comment:*\n${escapeMrkdwn(request.user_comment)}`,
        },
      });
    }

    blocks.push({ type: 'divider' });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🕒 Approval Timeline:*',
      },
    });

    const commentsByStep = this.getGroupedCommentsByStep(reviewComments);
    const groupedStepsByLevel = this.getGroupedStepsByLevel(steps);

    const sortedLevels = this.getSortedLevels(Object.keys(groupedStepsByLevel));

    sortedLevels.forEach((level) => {
      const steps = groupedStepsByLevel[level];

      const lines: string[] = [`*Step ${level}*`];

      steps.forEach((step) => {
        const stepComments = commentsByStep[step.id] || [];

        const stepSummary = this.getStepSummary(step, stepComments);

        stepSummary.forEach((summaryLine) => {
          lines.push(`    ${summaryLine}`);
        });
      });

      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: lines.join('\n') }],
      });
    });

    if (steps.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No approval steps defined._' },
      });
    }

    if (reviewComments.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No approver comments yet._' },
      });
    }

    return blocks;
  }

  private getStepSummary(
    step: IRequestWorkflowStepViewModel,
    stepComments: IWorkflowStepCommentViewModel[],
  ) {
    const statusEmoji = STEP_STATUS_EMOJI[step.step_data.status] ?? '⏳';

    const decidedBy = step.step_data.decided_by_slack_id
      ? `<@${step.step_data.decided_by_slack_id}>`
      : `<@${step.slack_user_id}>`;

    const lines: string[] = [
      `${statusEmoji} *${capitalize(step.step_data.status)}* by ${decidedBy}`,
    ];

    if (stepComments.length > 0) {
      stepComments.forEach((c) => {
        lines.push(`• ${escapeMrkdwn(c.comment)} (by <@${c.slack_user_id}>)`);
      });
    }

    return lines;
  }

  private getGroupedCommentsByStep(comments: IWorkflowStepCommentViewModel[]) {
    return comments.reduce(
      (acc, comment) => {
        if (!acc[comment.step_id]) {
          acc[comment.step_id] = [];
        }

        acc[comment.step_id].push(comment);

        return acc;
      },
      {} as Record<string, IWorkflowStepCommentViewModel[]>,
    );
  }

  private getGroupedStepsByLevel(steps: IRequestWorkflowStepViewModel[]) {
    return steps.reduce(
      (acc, step) => {
        if (!acc[step.step_level]) {
          acc[step.step_level] = [];
        }

        acc[step.step_level].push(step);

        return acc;
      },
      {} as Record<number, IRequestWorkflowStepViewModel[]>,
    );
  }

  private getSortedLevels(levels: string[]) {
    return levels.map((level) => parseInt(level, 10)).sort((a, b) => a - b);
  }
}
