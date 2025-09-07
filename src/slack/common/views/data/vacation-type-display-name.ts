import VacationType from 'src/common/enums/vacation-type.enum';

export const VACATION_TYPE_DISPLAY_NAME_MAP = {
  [VacationType.AnnualLeave]: 'Annual Leave',
  [VacationType.BonusDay]: 'Bonus Day',
  [VacationType.SickLeave]: 'Sick Leave',
  [VacationType.UnpaidLeave]: 'Unpaid Leave',
  [VacationType.Other]: 'Other',
};
