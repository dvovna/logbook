import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

export const TIME_ENTRIES_SUBMITTED = 'time_entries.submitted';

// Entries went to their approvers: by their owner submitting them, or by
// Admin or HR logging them as submitted. The approvers hear of it.
export class TimeEntriesSubmittedEvent {
  public constructor(
    public readonly entries: ITimeEntryViewModel[],
    public readonly slackTeamId: string,
    // Who sent them: not told about what they did themselves.
    public readonly submittedById: string,
  ) {}
}
