import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { IVacationUsageByType } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import {
  getCurrentVacationPeriod,
  getJoinedVacationPeriod,
  getVacationPeriodsBetween,
} from '@modules/vacation-requests/utils/vacation-period.utils';
import {
  IVacationDaysUsage,
  VacationPeriodUsageService,
} from '@modules/vacation-requests/services/vacation-period-usage.service';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';
import { getDateOnly } from '@common/utils/date.utils';

export interface IVacationLimits {
  vacationDays: number;
  daysTotal: number;
  workingDays: number;
  bonusDays: number;
  // Carried into the year, in calendar and in working days.
  carryoverDays: number;
  carryoverWorkingDays: number;
}

export interface IVacationPeriodUsageData {
  periodStart: Date;
  periodEnd: Date;
  usage: IVacationUsageByType;
  limits: IVacationLimits | null;
}

interface IVacationsUsageService {
  getCurrentVacationPeriodUsage(
    user: IUserViewModel,
  ): Promise<IVacationPeriodUsageData>;
  getVacationPeriodUsage(
    user: IUserViewModel,
    date: Date,
    options?: { excludeRequestId?: string },
  ): Promise<IVacationPeriodUsageData>;
}

@Injectable()
export class VacationsUsageService implements IVacationsUsageService {
  public constructor(
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationPeriodUsageService: VacationPeriodUsageService,
    private readonly vacationPoliciesService: VacationPoliciesService,
  ) {}

  public getCurrentVacationPeriodUsage(
    user: IUserViewModel,
  ): Promise<IVacationPeriodUsageData> {
    return this.getVacationPeriodUsage(user, new Date());
  }

  // The balance of the vacation year that holds `date`. `limits` is null
  // when no vacation policy applies to the user (neither their team's nor
  // the company rules'): usage is tracked, but nothing is enforced.
  public async getVacationPeriodUsage(
    user: IUserViewModel,
    date: Date,
    { excludeRequestId }: { excludeRequestId?: string } = {},
  ): Promise<IVacationPeriodUsageData> {
    const period = getCurrentVacationPeriod(user.contract_start_date, date);
    const joined = getJoinedVacationPeriod(
      user.contract_start_date,
      user.created_at,
    );
    const today = getDateOnly(new Date());
    const start = getDateOnly(period.periodStart);
    const joinedStart = getDateOnly(joined.periodStart);
    // Carryover comes from the years before, back to the one the person
    // joined in. A year still to come gets none yet: what will be left of
    // this one isn't known.
    const carryover: CarryoverSource =
      start > today || start < joinedStart
        ? 'none'
        : start === joinedStart
          ? 'entered'
          : 'years-before';
    const periods =
      carryover === 'years-before'
        ? getVacationPeriodsBetween(
            user.contract_start_date,
            joined.periodStart,
            period.periodEnd,
          )
        : [period];
    const ownRules = this.teamRulesService.forTeam(
      user.team_id,
      user.slack_team_id,
    );

    const [usageByPeriod, policy] = await Promise.all([
      this.vacationPeriodUsageService.getUsageByPeriods(user, periods, {
        excludeRequestId,
        ownRules,
      }),
      this.findPolicy(user, ownRules),
    ]);
    const periodUsage = usageByPeriod[usageByPeriod.length - 1];
    const limits =
      policy &&
      limitsOf(
        policy,
        carryoverInto(user, policy, carryover, usageByPeriod.slice(0, -1)),
      );

    const {
      carryoverDays = 0,
      carryoverWorkingDays = 0,
      vacationDays = 0,
      workingDays = 0,
      bonusDays = 0,
    } = limits || {};

    const availableDays =
      carryoverDays + vacationDays - periodUsage.annualLeaveUsed;
    const availableWorkingDays =
      carryoverWorkingDays +
      workingDays -
      periodUsage.annualLeaveWorkingDaysUsed;
    const availableBonusDays = bonusDays - periodUsage.bonusUsed;

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      limits,
      usage: {
        [VacationType.AnnualLeave]: {
          used: periodUsage.annualLeaveUsed,
          available: availableDays < 0 ? 0 : availableDays,
          working_days_used: periodUsage.annualLeaveWorkingDaysUsed,
          working_days_available:
            availableWorkingDays < 0 ? 0 : availableWorkingDays,
        },
        [VacationType.BonusDay]: {
          used: periodUsage.bonusUsed,
          available: availableBonusDays < 0 ? 0 : availableBonusDays,
        },
        [VacationType.SickLeave]: { used: periodUsage.sickUsed },
        [VacationType.UnpaidLeave]: { used: periodUsage.unpaidUsed },
        [VacationType.Other]: { used: periodUsage.otherUsed },
      },
    };
  }

  private async findPolicy(
    user: IUserViewModel,
    ownRules: Promise<IEffectiveTeamRules>,
  ): Promise<IVacationPolicyViewModel | null> {
    const { vacationPolicyId } = await ownRules;

    return vacationPolicyId
      ? this.vacationPoliciesService.findOne({
          id: vacationPolicyId,
          slackTeamId: user.slack_team_id,
        })
      : null;
  }
}

// Where a year's carryover comes from: none, what HR entered for the time
// before the person joined, or what was left of the years before.
type CarryoverSource = 'none' | 'entered' | 'years-before';

// In the year the person joined, what HR entered; in each later one, what
// was left of the year before (its own days and its carryover), up to the
// policy's most. Calendar and working days apart, as they are limited.
const carryoverInto = (
  user: IUserViewModel,
  policy: IVacationPolicyViewModel,
  source: CarryoverSource,
  yearsBefore: IVacationDaysUsage[],
) => {
  const most = policy.carryover_days || 0;

  if (source === 'none') {
    return { days: 0, workingDays: 0 };
  }

  const entered = Math.min(user.carryover_days || 0, most);
  let days = entered;
  let workingDays = entered;

  for (const used of yearsBefore) {
    days = clamp(
      (policy.vacation_days || 0) + days - used.annualLeaveUsed,
      most,
    );
    workingDays = clamp(
      (policy.working_days || 0) +
        workingDays -
        used.annualLeaveWorkingDaysUsed,
      most,
    );
  }

  return { days, workingDays };
};

const clamp = (days: number, most: number) => Math.max(0, Math.min(days, most));

const limitsOf = (
  policy: IVacationPolicyViewModel,
  carryover: { days: number; workingDays: number },
): IVacationLimits => ({
  vacationDays: policy.vacation_days || 0,
  workingDays: policy.working_days || 0,
  bonusDays: policy.bonus_days || 0,
  carryoverDays: carryover.days,
  carryoverWorkingDays: carryover.workingDays,
  daysTotal: (policy.vacation_days || 0) + carryover.days,
});
