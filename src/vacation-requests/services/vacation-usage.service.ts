import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { IVacationUsageByType } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { getCurrentVacationPeriod } from '@modules/vacation-requests/utils/vacation-period.utils';
import { VacationPeriodUsageService } from '@modules/vacation-requests/services/vacation-period-usage.service';
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';
import { getDateOnly } from '@common/utils/date.utils';

export interface IVacationLimits {
  vacationDays: number;
  daysTotal: number;
  workingDays: number;
  bonusDays: number;
  carryoverDays: number;
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
  // Carryover counts only in the current year: it is what was left of the
  // year before.
  public async getVacationPeriodUsage(
    user: IUserViewModel,
    date: Date,
    { excludeRequestId }: { excludeRequestId?: string } = {},
  ): Promise<IVacationPeriodUsageData> {
    const { periodStart, periodEnd } = getCurrentVacationPeriod(
      user.contract_start_date,
      date,
    );
    const today = getDateOnly(new Date());
    const isCurrent =
      getDateOnly(periodStart) <= today && today <= getDateOnly(periodEnd);
    const ownRules = this.teamRulesService.forTeam(
      user.team_id,
      user.slack_team_id,
    );

    const [periodUsage, limits] = await Promise.all([
      this.vacationPeriodUsageService.getPeriodUsage(
        user,
        periodStart,
        periodEnd,
        { excludeRequestId, ownRules },
      ),
      this.getVacationPeriodLimits(
        user,
        ownRules,
        isCurrent ? user.carryover_days || 0 : 0,
      ),
    ]);

    const {
      carryoverDays = 0,
      vacationDays = 0,
      workingDays = 0,
      bonusDays = 0,
    } = limits || {};

    const availableDays =
      carryoverDays + vacationDays - periodUsage.annualLeaveUsed;
    const availableWorkingDays =
      carryoverDays + workingDays - periodUsage.annualLeaveWorkingDaysUsed;
    const availableBonusDays = bonusDays - periodUsage.bonusUsed;

    return {
      periodStart,
      periodEnd,
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

  private async getVacationPeriodLimits(
    user: IUserViewModel,
    ownRules: Promise<IEffectiveTeamRules>,
    carryoverDays: number,
  ): Promise<IVacationLimits | null> {
    const { vacationPolicyId } = await ownRules;

    const policy = vacationPolicyId
      ? await this.vacationPoliciesService.findOne({
          id: vacationPolicyId,
          slackTeamId: user.slack_team_id,
        })
      : null;

    if (!policy) {
      return null;
    }

    return {
      vacationDays: policy.vacation_days || 0,
      workingDays: policy.working_days || 0,
      bonusDays: policy.bonus_days || 0,
      carryoverDays,
      daysTotal: (policy.vacation_days || 0) + carryoverDays,
    };
  }
}
