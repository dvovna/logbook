import pluralize from 'pluralize';
import { getDisplayTime, sumMinutes } from '@common/utils/time.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// Nothing when there was nothing to send.
export const submittedNotice = (entries: ITimeEntryViewModel[]) =>
  entries.length
    ? `✅ ${pluralize('time entry', entries.length, true)} (${getDisplayTime(sumMinutes(entries))}) sent for approval.`
    : undefined;
