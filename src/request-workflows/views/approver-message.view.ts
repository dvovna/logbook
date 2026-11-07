import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ApproverMessageActionId } from '@modules/request-workflows/enums/approver-message-action-id.enum';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import { getApproverCommentLines } from '@modules/slack/common/utils/view.utils';

interface IGetMessageParams {
  step: IRequestWorkflowStepViewModel;
  comments?: IWorkflowStepCommentViewModel[];
}

export class ApproverMessageView {
  public static getMessage(params: IGetMessageParams) {
    switch (params.step.step_data.status) {
      case WorkflowStepStatus.Approved: {
        return this.getApprovedMessage(params);
      }
      case WorkflowStepStatus.Rejected: {
        return this.getRejectedMessage(params);
      }
      case WorkflowStepStatus.Pending: {
        return this.getPendingMessage(params);
      }
      case WorkflowStepStatus.Cancelled: {
        return this.getCanceledMessage(params);
      }
    }
  }

  private static getPendingMessage({ step, comments }: IGetMessageParams) {
    return {
      text: `:wave: You have a new vacation request to approve.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: this.getRequestSummary(step, comments),
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
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Comment 💬' },
              action_id: ApproverMessageActionId.AddComment,
              value: `${ApproverMessageActionId.AddComment}:${step.id}`,
            },
          ],
        },
      ],
    };
  }

  private static getApprovedMessage({ step, comments }: IGetMessageParams) {
    return {
      text: '✅ Vacation request approved',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Approved by <@${step.step_data.decided_by_slack_id}>

${this.getRequestDetails(step, comments)}`,
          },
        },
      ],
    };
  }

  private static getRejectedMessage({ step, comments }: IGetMessageParams) {
    return {
      text: '❌ Vacation request rejected',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ Rejected by <@${step.step_data.decided_by_slack_id}>

${this.getRequestDetails(step, comments)}`,
          },
        },
      ],
    };
  }

  private static getCanceledMessage({ step, comments }: IGetMessageParams) {
    // decided_by is whoever closed the step: the requester or an admin who
    // changed the request.
    const canceledBy =
      step.step_data.decided_by_slack_id ?? step.step_data.snapshot.slack_user_id;

    return {
      text: '❌ Vacation request canceled',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ Canceled by <@${canceledBy}>

${this.getRequestDetails(step, comments)}`,
          },
        },
      ],
    };
  }

  private static getRequestDetails(
    step: IRequestWorkflowStepViewModel,
    approverComments: IWorkflowStepCommentViewModel[] = [],
  ) {
    const lines: string[] = [];

    lines.push(`*Request details:*`);
    lines.push(`👤 Employee: ${escapeMrkdwn(step.step_data.snapshot.user_name)}`);
    lines.push(...this.getBasicRequestLines(step));
    lines.push(...this.getUserCommentLines(step));

    if (approverComments.length) {
      lines.push(...getApproverCommentLines(approverComments));
    }

    return lines.join('\n');
  }

  private static getRequestSummary(
    step: IRequestWorkflowStepViewModel,
    approverComments: IWorkflowStepCommentViewModel[] = [],
  ) {
    const lines: string[] = [];

    lines.push(`⏳ Vacation request for ${escapeMrkdwn(step.step_data.snapshot.user_name)}`);
    lines.push(...this.getBasicRequestLines(step));

    if (step.step_data.snapshot.comment) {
      lines.push(`💬 User comment: ${escapeMrkdwn(step.step_data.snapshot.comment)}`);
    }

    lines.push(...getApproverCommentLines(approverComments));
    lines.push(`⚡ Needs your approval`);

    return lines.join('\n');
  }

  private static getBasicRequestLines(step: IRequestWorkflowStepViewModel) {
    return [
      `📅 Dates: ${step.step_data.snapshot.start_date} → ${step.step_data.snapshot.end_date} (${step.step_data.snapshot.days} calendar days, ${step.step_data.snapshot.working_days} working days)`,
      `🏖️ Type: ${VACATION_TYPE_DISPLAY_NAME_MAP[step.step_data.snapshot.type]}`,
    ];
  }

  private static getUserCommentLines(step: IRequestWorkflowStepViewModel) {
    return step.step_data.snapshot.comment
      ? [`💬 User comment: ${escapeMrkdwn(step.step_data.snapshot.comment)}\n`]
      : [];
  }
}
