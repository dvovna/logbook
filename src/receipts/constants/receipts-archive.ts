import { ARCHIVE_PART_BYTES } from '@modules/receipts/constants/receipt-limits';

export interface IReceiptsArchiveLimits {
  // The most the files of one part of a month's archive add up to: what the
  // app holds of them at once, and what one upload carries.
  partBytes: number;
}

export const RECEIPTS_ARCHIVE_LIMITS = Symbol('RECEIPTS_ARCHIVE_LIMITS');

export const DEFAULT_RECEIPTS_ARCHIVE_LIMITS: IReceiptsArchiveLimits = {
  partBytes: ARCHIVE_PART_BYTES,
};
