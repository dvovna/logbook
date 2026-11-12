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

export interface IVacationLimits {
  vacationDays: number;
  daysTotal: number;
  workingDays: number;
  bonusDays: number;
  // Carried into the year, in calendar and in working days.
  carryoverDays: number;
  carryoverWorkingDays: number;
  // What a balance from a file changes in the year that holds its date: what
  // the file says was left then, minus what Logbook counted. 0 for a unit the
  // file left empty.
  correction: {
    balanceOn: string;
    days: number;
    workingDays: number;
    bonusDays: number;
  } | null;
}

export interface IVacationPeriodUsageData {
  periodStart: Date;
  periodEnd: Date;
  usage: IVacationUsageByType;
  limits: IVacationLimits | null;
}
