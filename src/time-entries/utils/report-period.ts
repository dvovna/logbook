import { ValidationError } from '@common/errors/validation.error';
import { DAY_MS, isIsoDate } from '@common/utils/date.utils';

// A time report or export covers a year at most, so that one request reads a
// bounded number of entries.
export const MAX_REPORT_DAYS = 366;

// Days from `fromDate` to `toDate`, both counted.
export const daysInPeriod = (fromDate: string, toDate: string) =>
  Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      DAY_MS,
  ) + 1;

// A period that may be open on either side (the uninvoiced report): each
// date it has must be a real day, and the end not before the start.
export const assertOpenPeriod = (fromDate?: string, toDate?: string) => {
  if (
    (fromDate !== undefined && !isIsoDate(fromDate)) ||
    (toDate !== undefined && !isIsoDate(toDate))
  ) {
    throw new ValidationError('Choose real dates, or none.');
  }

  if (fromDate && toDate && toDate < fromDate) {
    throw new ValidationError('End date must not be before the start date.');
  }
};

// The period comes from a form or from the tab's metadata, so it is checked
// wherever a report is made.
export const assertReportPeriod = (fromDate: string, toDate: string) => {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
    throw new ValidationError('Choose a start and an end date.');
  }

  if (toDate < fromDate) {
    throw new ValidationError('End date must not be before the start date.');
  }

  if (daysInPeriod(fromDate, toDate) > MAX_REPORT_DAYS) {
    throw new ValidationError('Choose a period of a year at most.');
  }
};
