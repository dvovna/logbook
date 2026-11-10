import { IUserViewModel } from '@modules/users/types/user.interface';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

export const TIME_ENTRIES_SUBMITTED = 'time_entries.submitted';

// Someone sent their entries for approval: their approvers hear of it.
export class TimeEntriesSubmittedEvent {
  public constructor(
    public readonly entries: ITimeEntryViewModel[],
    public readonly owner: IUserViewModel,
  ) {}
}
