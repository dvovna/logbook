import { TimeOffChange } from '@modules/slack/tabs/vacation-requests/types/time-off-offer.types';

export const LOG_TIME_OFF_ACTION_ID = 'log_time_off';

export const TIME_OFF_OFFER_JOB = 'time-off-offer-send';

// How the removal DM says it: 'Your annual leave 15–19 Jun 2026 was rejected'.
export const TIME_OFF_CHANGE_WORDS: Record<TimeOffChange, string> = {
  changed: 'changed',
  rejected: 'was rejected',
  canceled: 'was canceled',
  pending: 'waits for approval again',
  deleted: 'was deleted',
  moved: 'was moved to someone else',
};
