import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { IOption } from '@modules/slack/common/types/option.interface';

export const TIME_LOG_STATUS_OPTIONS: IOption[] = [
  { name: 'Draft', id: TimeEntryStatus.Draft },
  { name: 'Submitted', id: TimeEntryStatus.Submitted },
  { name: 'Cancelled', id: TimeEntryStatus.Cancelled },
  { name: 'Approved', id: TimeEntryStatus.Approved },
  { name: 'Rejected', id: TimeEntryStatus.Rejected },
];
