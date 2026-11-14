import { formatDate } from '@common/utils/date.utils';

// An approver left out because of approved time off; `until` is the last day
// of that time off.
export interface IAwayApprover {
  slackId: string;
  until: string | null;
}

export const onTimeOffText = (slackId: string, until: string | null) =>
  `<@${slackId}> is on time off${until ? ` until ${formatDate(until)}` : ''}`;

export const onTimeOffTextOf = (away: IAwayApprover[]) =>
  away.map(({ slackId, until }) => onTimeOffText(slackId, until)).join(', ');
