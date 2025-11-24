import { PlainTextOption } from '@slack/web-api';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ALL_OPTION_VALUE } from '@modules/slack/common/views/data/all-option-value';

export const STATUS_OPTIONS: PlainTextOption[] = [
  {
    text: { type: 'plain_text', text: 'Approved ✅' },
    value: VacationRequestStatus.Approved,
  },
  {
    text: { type: 'plain_text', text: 'Pending ⏳' },
    value: VacationRequestStatus.Pending,
  },
  {
    text: { type: 'plain_text', text: 'Rejected ❌' },
    value: VacationRequestStatus.Rejected,
  },
  {
    text: { type: 'plain_text', text: 'Canceled 🛑' },
    value: VacationRequestStatus.Canceled,
  },
];

export const ALL_STATUSES_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Statuses' },
  value: ALL_OPTION_VALUE,
};
