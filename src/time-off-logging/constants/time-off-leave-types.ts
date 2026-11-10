import VacationType from '@common/enums/vacation-type.enum';

// The leave types that time off is logged for, each on a project of its own.
// "Other" has none.
export const TIME_OFF_LEAVE_TYPES = [
  VacationType.AnnualLeave,
  VacationType.BonusDay,
  VacationType.SickLeave,
  VacationType.UnpaidLeave,
] as const;

export type TimeOffLeaveType = (typeof TIME_OFF_LEAVE_TYPES)[number];

export const isTimeOffLeaveType = (type: string): type is TimeOffLeaveType =>
  (TIME_OFF_LEAVE_TYPES as readonly string[]).includes(type);

// The description of the entries a time off is logged as, so that lists say
// why the hours are there. The domain's own words: the Slack labels
// (labels.ts) are the UI's.
export const TIME_OFF_DESCRIPTIONS: Record<TimeOffLeaveType, string> = {
  [VacationType.AnnualLeave]: 'Annual leave',
  [VacationType.BonusDay]: 'Bonus day',
  [VacationType.SickLeave]: 'Sick leave',
  [VacationType.UnpaidLeave]: 'Unpaid leave',
};
