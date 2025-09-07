import { PlainTextOption } from '@slack/web-api';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { ALL_OPTION_VALUE } from 'src/slack/common/views/data/all-option-value';

export const STATUS_OPTIONS: PlainTextOption[] = [
  {
    text: { type: 'plain_text', text: 'Approved ✅' },
    value: VacationStatus.Approved,
  },
  {
    text: { type: 'plain_text', text: 'Pending ⏳' },
    value: VacationStatus.Pending,
  },
  {
    text: { type: 'plain_text', text: 'Rejected ❌' },
    value: VacationStatus.Rejected,
  },
  {
    text: { type: 'plain_text', text: 'Canceled 🛑' },
    value: VacationStatus.Cancelled,
  },
];

export const ALL_STATUSES_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'All Statuses' },
  value: ALL_OPTION_VALUE,
};
