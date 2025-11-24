import { IOption } from '@modules/slack/common/types/option.interface';
import { PlainTextOption } from '@slack/web-api';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ButtonAction } from '@slack/bolt';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

export const toPlainTextOption = ({ id, name }: IOption): PlainTextOption => {
  return {
    text: {
      type: 'plain_text',
      text: name,
    },
    value: id,
  };
};

export function withButtonAction(
  handler: (value: string, user: IUserViewModel, trigger_id: string) => unknown,
) {
  return (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const buttonValue = (payload.actions[0] as ButtonAction).value;

    const [action, value] = buttonValue?.split(':') || [];

    if (!action || !value) {
      throw new Error('Invalid button value format');
    }

    return handler(value, user, payload.trigger_id);
  };
}

export const getApproverCommentLines = (
  approverComments: IWorkflowStepCommentViewModel[],
) => {
  const lines: string[] = [];

  if (approverComments && approverComments.length > 0) {
    lines.push(`\n📝 Approver comments:`);

    approverComments.forEach((comment) => {
      lines.push(`• ${comment.comment} (by <@${comment.slack_user_id}>)`);
    });
  }

  return lines;
};
