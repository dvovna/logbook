import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { IVacationUsageByType } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { getCurrentVacationPeriod } from '@modules/vacation-requests/utils/vacation-period.utils';
import { VacationPeriodUsageService } from '@modules/vacation-requests/services/vacation-period-usage.service';

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
}

@Injectable()
export class VacationsUsageService implements IVacationsUsageService {
  public constructor(
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationPeriodUsageService: VacationPeriodUsageService,
    private readonly vacationPoliciesService: VacationPoliciesService,
  ) {}

  // `limits` is null when no vacation policy applies to the user (neither
  // their team's nor the company rules'): usage is tracked, but nothing is
  // enforced.
  public async getCurrentVacationPeriodUsage(
    user: IUserViewModel,
  ): Promise<IVacationPeriodUsageData> {
    const { periodStart, periodEnd } = getCurrentVacationPeriod(
      user.contract_start_date,
    );

    const [periodUsage, limits] = await Promise.all([
      this.vacationPeriodUsageService.getPeriodUsage(
        user,
        periodStart,
        periodEnd,
      ),
      this.getVacationPeriodLimits(user),
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

  private async getVacationPeriodLimits(user: IUserViewModel) {
    const teamVacationPolicy = await this.getVacationPolicyIfExists(user);

    return (
      teamVacationPolicy && {
        vacationDays: teamVacationPolicy?.vacation_days || 0,
        workingDays: teamVacationPolicy?.working_days || 0,
        bonusDays: teamVacationPolicy?.bonus_days || 0,
        carryoverDays: user.carryover_days || 0,
        daysTotal:
          (teamVacationPolicy?.vacation_days || 0) + (user.carryover_days || 0),
      }
    );
  }

  // The policy of the user's team, or of the company rules for a team that
  // follows them and for someone in no team.
  private async getVacationPolicyIfExists(user: IUserViewModel) {
    const { vacationPolicyId } = await this.teamRulesService.forTeam(
      user.team_id,
      user.slack_team_id,
    );

    if (!vacationPolicyId) {
      return null;
    }

    return this.vacationPoliciesService.findOne({
      id: vacationPolicyId,
      slackTeamId: user.slack_team_id,
    });
  }
}
