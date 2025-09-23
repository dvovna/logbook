import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ApproverMessageActionId } from 'src/request-workflows/enums/approver-message-action-id.enum';
import { IRequestWorkflowStepViewModel } from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';

interface IGetMessageParams {
  step: IRequestWorkflowStepViewModel;
  comments: IWorkflowStepCommentViewModel[];
}

export class ApproverMessageView {
  public static getMessage(params: IGetMessageParams) {
    switch (params.step.step_data.status) {
      case 'approved': {
        return this.getApprovedMessage(params);
      }
      case 'rejected': {
        return this.getRejectedMessage(params);
      }
      case 'pending': {
        return this.getPendingMessage(params);
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

  private static getRequestDetails(
    step: IRequestWorkflowStepViewModel,
    approverComments: IWorkflowStepCommentViewModel[],
  ) {
    const lines: string[] = [];

    lines.push(`*Request details:*`);
    lines.push(`👤 Employee: ${step.step_data.snapshot.user_name}`);
    lines.push(...this.getBasicRequestLines(step));
    lines.push(...this.getUserCommentLines(step));
    lines.push(...this.getApproverCommentLines(approverComments));

    return lines.join('\n');
  }

  private static getRequestSummary(
    step: IRequestWorkflowStepViewModel,
    approverComments: IWorkflowStepCommentViewModel[],
  ) {
    const lines: string[] = [];

    lines.push(`⏳ Vacation request for ${step.step_data.snapshot.user_name}`);
    lines.push(...this.getBasicRequestLines(step));

    if (step.step_data.snapshot.comment) {
      lines.push(`💬 User comment: ${step.step_data.snapshot.comment}`);
    }

    lines.push(...this.getApproverCommentLines(approverComments));
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
      ? [`💬 User comment: ${step.step_data.snapshot.comment}\n`]
      : [];
  }

  private static getApproverCommentLines(
    approverComments: IWorkflowStepCommentViewModel[],
  ) {
    const lines: string[] = [];

    if (approverComments && approverComments.length > 0) {
      lines.push(`\n📝 Approver comments:`);

      approverComments.forEach((comment) => {
        lines.push(`• ${comment.comment} (by <@${comment.slack_user_id}>)`);
      });
    }

    return lines;
  }
}
