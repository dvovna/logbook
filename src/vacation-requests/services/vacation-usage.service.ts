import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import { IVacationUsageByType } from 'src/vacation-requests/types/user-vacations-usage-info.interface';
import TeamsService from 'src/teams/services/teams.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { getCurrentVacationPeriod } from 'src/vacation-requests/utils/vacation-period.utils';
import { VacationPeriodUsageService } from 'src/vacation-requests/services/vacation-period-usage.service';

export interface IVacationPeriodUsageData {
  periodStart: Date;
  periodEnd: Date;
  usage: IVacationUsageByType;
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

    const [periodUsage, userTeam] = await Promise.all([
      this.vacationPeriodUsageService.getPeriodUsage(
        user,
        periodStart,
        periodEnd,
      ),
      this.teamsService.findOneWithValidation({
        id: user.team_id,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    const teamVacationPolicy =
      await this.vacationPoliciesService.findOneWithValidation({
        id: userTeam.vacation_policy_id,
        slackTeamId: user.slack_team_id,
      });

    const carryoverDays = user.carryover_days || 0;
    const availableDays =
      carryoverDays +
      teamVacationPolicy.vacation_days -
      periodUsage.annualLeaveUsed;
    const availableWorkingDays =
      carryoverDays +
      teamVacationPolicy.working_days -
      periodUsage.annualLeaveWorkingDaysUsed;
    const availableBonusDays =
      teamVacationPolicy.bonus_days - periodUsage.bonusUsed;

    return {
      periodStart,
      periodEnd,
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
}
