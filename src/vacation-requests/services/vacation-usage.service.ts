import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import { IVacationUsageByType } from 'src/vacation-requests/types/user-vacations-usage-info.interface';
import TeamsService from 'src/teams/services/teams.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { getCurrentVacationPeriod } from 'src/vacation-requests/utils/vacation-period.utils';
import { VacationPeriodUsageService } from 'src/vacation-requests/services/vacation-period-usage.service';

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
  ): Promise<IVacationPeriodUsageData | null>;
}

@Injectable()
export class VacationsUsageService implements IVacationsUsageService {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly vacationPeriodUsageService: VacationPeriodUsageService,
    private readonly vacationPoliciesService: VacationPoliciesService,
  ) {}

  public async getCurrentVacationPeriodUsage(user: IUserViewModel) {
    if (!user.contract_start_date) {
      return null;
    }

    const { periodStart, periodEnd } = getCurrentVacationPeriod(
      user.contract_start_date,
    );

    const periodUsage = await this.vacationPeriodUsageService.getPeriodUsage(
      user,
      periodStart,
      periodEnd,
    );

    const limits = await this.getVacationPeriodLimits(user);

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

  private async getVacationPeriodLimits(user: IUserViewModel) {
    const teamVacationPolicy = await this.getVacationPolicyIfExists(user);

    return teamVacationPolicy && {
      vacationDays: teamVacationPolicy?.vacation_days || 0,
      workingDays: teamVacationPolicy?.working_days || 0,
      bonusDays: teamVacationPolicy?.bonus_days || 0,
      carryoverDays: user.carryover_days || 0,
        daysTotal:
          (teamVacationPolicy?.vacation_days || 0) +
        (user.carryover_days || 0),
    };
  }

  private async getVacationPolicyIfExists(user: IUserViewModel) {
    const userTeam = user.team_id
      ? await this.teamsService.findOneWithValidation({
        id: user.team_id,
        slackTeamId: user.slack_team_id,
      })
      : null;

    if (!userTeam || !userTeam.vacation_policy_id) {
      return null;
    }

    return this.vacationPoliciesService.findOne({
      id: userTeam.vacation_policy_id,
      slackTeamId: user.slack_team_id,
    });
  }
}
