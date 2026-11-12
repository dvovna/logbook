import { MAX_COMMENT_LENGTH } from '@common/constants/text-limits';

export const LEAVE_FILE_UNUSABLE_REASONS = {
  noEmail: 'Row has no email',
  notInWorkspace: (email: string) => `${email} isn't in this Slack workspace`,
  deactivated: (name: string) => `${name} is deactivated`,
  duplicate: (name: string, row: number) => `${name} is already on row ${row}`,
  invalidDate: (column: string, text: string) =>
    `${column} "${text}" isn't a date: write it as 2026-11-12`,
  ambiguousDate: (column: string, text: string) =>
    `${column} "${text}" could be day/month or month/day: write dates as 2026-11-12 or save the file as Excel`,
  inconsistentDates: (column: string, text: string) =>
    `${column} "${text}": the file's dates with / mix day/month and month/day; write dates as 2026-11-12`,
  invalidDays: (column: string, text: string) =>
    `${column} "${text}" isn't a number of days`,
  notHalf: (column: string, text: string) =>
    `${column} "${text}": Logbook counts whole and half days`,
  balanceOnFuture: (text: string) => `Balance on ${text} is after today`,
  balanceOnOutsideYear: (name: string, yearStart: string) =>
    `Balance on must fall in ${name}'s current vacation year, which starts ${yearStart}`,
  noPolicy: (name: string) =>
    `${name} follows no vacation policy, so there is no balance to set. Set a policy first.`,
  unknownType: (text: string) =>
    `"${text}" is not a leave type (use Annual leave, Bonus day, Sick leave, Unpaid leave or Other)`,
  missingDates: 'From and To are both needed',
  endsBeforeStart: 'To is before From',
  tooFarAhead: (text: string) => `To ${text} is more than a year ahead`,
  commentTooLong: `Comment is longer than ${MAX_COMMENT_LENGTH} characters`,
  overlapsRequest: (name: string, typeName: string, range: string) =>
    `overlaps ${name}'s ${typeName} ${range}`,
  overlapsRow: (row: number) => `overlaps row ${row}`,
};
