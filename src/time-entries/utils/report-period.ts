import { ValidationError } from '@common/errors/validation.error';

// A time report or export covers a year at most, so that one request reads a
// bounded number of entries.
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

// "2026-11-03", and a day that exists (not "2026-02-30").
const isIsoDate = (date: unknown): date is string => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const time = Date.parse(`${date}T00:00:00Z`);

  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(date);
};

// Days from `fromDate` to `toDate`, both counted.
export const daysInPeriod = (fromDate: string, toDate: string) =>
  Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      DAY_MS,
  ) + 1;

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
