export interface ITimeEntriesExportLimits {
  // Lines read from the database at a time: what the export holds of the
  // entries at once.
  pageSize: number;
  // The most lines a file may have: a year of a 400-person workspace is
  // about 300,000 entries, some 50 MB of text the app holds while it
  // uploads the file.
  maxEntries: number;
}

export const TIME_ENTRIES_EXPORT_LIMITS = Symbol('TIME_ENTRIES_EXPORT_LIMITS');

export const DEFAULT_TIME_ENTRIES_EXPORT_LIMITS: ITimeEntriesExportLimits = {
  pageSize: 5000,
  maxEntries: 200_000,
};
