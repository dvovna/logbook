import VacationType from '@common/enums/vacation-type.enum';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';

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
  // The days of the year in all, as what is available counts them: the
  // allowance, the carryover and a file's correction.
  daysTotal: number;
  workingDays: number;
  bonusDays: number;
  // Carried into the year, in calendar and in working days.
  carryoverDays: number;
  carryoverWorkingDays: number;
  // What a balance from a file changes in the year that holds its date: what
  // the file says was left then, minus what Logbook counted. Null for a unit
  // the file left empty; 0 for one it gave as Logbook counted it.
  correction: {
    balanceOn: string;
    days: number | null;
    workingDays: number | null;
    bonusDays: number | null;
  } | null;
}

export interface IVacationPeriodUsageData {
  periodStart: Date;
  periodEnd: Date;
  usage: IVacationUsageByType;
  limits: IVacationLimits | null;
}

// The usage as VacationsUsageService reads it, with the person's balance from
// a file as stored, whichever year it counts in, for the screens that name
// it.
export interface IVacationPeriodUsage extends IVacationPeriodUsageData {
  fileBalance: ILeaveBalance | null;
}
