// An entry in a billing snapshot is locked: nobody edits, deletes,
// approves or rejects it until an admin unlocks the snapshot. The app checks
// that first (TimeEntriesValidationService); the trigger
// time_entries_keep_billed refuses what gets past, with this SQLSTATE.
export const BILLED_ENTRY_MESSAGE =
  "This time entry is in a billing snapshot: it can't be changed until an admin unlocks the snapshot.";

export const BILLED_ENTRY_SQLSTATE = 'LB001';

// The trigger's error, as the pg driver throws it or as a repository wraps
// it (with the driver's error as its cause).
export const isBilledEntryError = (error: unknown): boolean => {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: unknown };

  return (
    code === BILLED_ENTRY_SQLSTATE || (!!cause && isBilledEntryError(cause))
  );
};
