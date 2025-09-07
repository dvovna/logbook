import { PlainTextOption } from '@slack/web-api';
import VacationType from 'src/common/enums/vacation-type.enum';

export const VACATION_TYPE_OPTIONS: PlainTextOption[] = [
  {
    text: { type: 'plain_text', text: 'Annual Leave' },
    value: VacationType.AnnualLeave,
  },
  {
    text: { type: 'plain_text', text: 'Bonus Day' },
    value: VacationType.BonusDay,
  },
  {
    text: { type: 'plain_text', text: 'Sick Leave' },
    value: VacationType.SickLeave,
  },
  {
    text: { type: 'plain_text', text: 'Unpaid Leave' },
    value: VacationType.UnpaidLeave,
  },
  {
    text: { type: 'plain_text', text: 'Other' },
    value: VacationType.Other,
  },
];
