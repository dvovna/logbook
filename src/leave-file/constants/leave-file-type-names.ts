import VacationType from '@common/enums/vacation-type.enum';

export const LEAVE_FILE_TYPE_NAMES: Record<VacationType, string> = {
  [VacationType.AnnualLeave]: 'Annual leave',
  [VacationType.BonusDay]: 'Bonus day',
  [VacationType.SickLeave]: 'Sick leave',
  [VacationType.UnpaidLeave]: 'Unpaid leave',
  [VacationType.Other]: 'Other',
};
