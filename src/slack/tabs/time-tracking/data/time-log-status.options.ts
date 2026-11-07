import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { IOption } from '@common/types/option.interface';

export const TIME_LOG_STATUS_OPTIONS: (IOption & { id: TimeEntryStatus })[] = [
  { name: 'Draft', id: TimeEntryStatus.Draft },
  { name: 'Submitted', id: TimeEntryStatus.Submitted },
  { name: 'Cancelled', id: TimeEntryStatus.Cancelled },
  { name: 'Approved', id: TimeEntryStatus.Approved },
  { name: 'Rejected', id: TimeEntryStatus.Rejected },
];

export const TIME_ENTRY_STATUS_DISPLAY_NAME = Object.fromEntries(
  TIME_LOG_STATUS_OPTIONS.map(({ id, name }) => [id, name]),
) as Record<TimeEntryStatus, string>;
