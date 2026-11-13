import { ARCHIVE_PART_BYTES } from '@modules/receipts/constants/receipt-limits';

export interface IReceiptsArchiveLimits {
  // The most the files of one part of a month's archive add up to: what the
  // app holds of them at once, and what one upload carries.
  partBytes: number;
  // How many parts' jobs start in a second. One part is sent at a time, and
  // a part started before the one ahead is done waits for it in a job slot:
  // about as slow as a part takes, so that a big month leaves the slots to
  // the rest.
  partsPerSecond: number;
}

export const RECEIPTS_ARCHIVE_LIMITS = Symbol('RECEIPTS_ARCHIVE_LIMITS');

export const DEFAULT_RECEIPTS_ARCHIVE_LIMITS: IReceiptsArchiveLimits = {
  partBytes: ARCHIVE_PART_BYTES,
  partsPerSecond: 0.2,
};
