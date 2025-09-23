import { Injectable } from '@nestjs/common';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { AnyBlock } from '@slack/web-api';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IRequestWorkflowStepViewModel } from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';
import capitalize from 'src/common/utils/capitalize';

interface IGetParams extends IBaseModalViewParams {
  request: IVacationRequestViewModel;
  steps: IRequestWorkflowStepViewModel[];
  reviewComments: IWorkflowStepCommentViewModel[];
}

@Injectable()
export class VacationRequestDetailsModalView extends BaseModalView<IGetParams> {
  protected callbackId = ViewCallbackId.ViewVacationRequestDetails;

  protected getTitleText() {
    return 'Vacation request details';
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
            text: `📌 *Status:*\n${request.status.toUpperCase()}`,
          },
        ],
      },
    ];

    if (request.user_comment) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 *User comment:*\n${request.user_comment}`,
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

    steps.forEach((step) => {
      const stepComments = commentsByStep[step.id] || [];

      const statusEmoji =
        step.step_data.status === 'approved'
          ? '✅'
          : step.step_data.status === 'rejected'
            ? '❌'
            : '⏳';

      const decidedBy = step.step_data.decided_by_slack_id
        ? `<@${step.step_data.decided_by_slack_id}>`
        : `<@${step.slack_user_id}>`;

      const lines: string[] = [
        `${statusEmoji} *${capitalize(step.step_data.status)}* by ${decidedBy}`,
      ];

      if (stepComments.length > 0) {
        stepComments.forEach((c) => {
          lines.push(`• ${c.comment} (by <@${c.slack_user_id}>)`);
        });
      }

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
}
