import VacationType from '@common/enums/vacation-type.enum';

interface IBaseUsage {
  used: number;
}

interface ILimitedUsage extends IBaseUsage {
  available: number;
}

interface IAnnualLeaveUsage extends ILimitedUsage {
  working_days_used: number;
  working_days_available: number;
}

export interface IVacationUsageByType {
  [VacationType.AnnualLeave]: IAnnualLeaveUsage;
  [VacationType.BonusDay]: ILimitedUsage;
  [VacationType.SickLeave]: IBaseUsage;
  [VacationType.UnpaidLeave]: IBaseUsage;
  [VacationType.Other]: IBaseUsage;
}
