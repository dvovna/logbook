import { IOption } from '@common/types/option.interface';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { PlainTextOption } from '@slack/web-api';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ButtonAction } from '@slack/bolt';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import pluralize from 'pluralize';
import { formatDateRange } from '@common/utils/date.utils';
import { vacationTypeLabel } from '@modules/slack/common/views/data/labels';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

// What Slack takes in a static select.
export const MAX_SELECT_OPTIONS = 100;

export const toPlainTextOption = <OptionType extends IOption = IOption>({
  id,
  name,
  description,
}: OptionType): PlainTextOption => ({
  text: {
    type: 'plain_text',
    text: name,
  },
  ...(description
    ? {
        description: {
          type: 'plain_text',
          text: description,
        },
      }
    : {}),
  value: id,
});

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
      lines.push(
        `• ${escapeMrkdwn(comment.comment)} (by <@${comment.slack_user_id}>)`,
      );
    });
  }

  return lines;
};

// '*Annual leave* · 6–10 Jul 2026 (5 days, 5 working)': a request in the
// messages that tell people of it.
export const requestDetailsLine = (
  request: Pick<
    IVacationRequestViewModel,
    'type' | 'start_date' | 'end_date' | 'days' | 'working_days'
  >,
) =>
  `*${vacationTypeLabel(request.type)}* · ${formatDateRange(request.start_date, request.end_date)} (${pluralize('day', request.days, true)}, ${request.working_days} working)`;
