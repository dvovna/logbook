import { Injectable, NotFoundException } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { IVacationUsageByType } from 'src/vacation-requests/types/user-vacations-usage-info.interface';
import TeamsService from 'src/teams/services/teams.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { VacationPoliciesCacheService } from 'src/vacation-policies/services/vacation-policies-cache.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { getDateOnly } from 'src/common/utils/date.utils';

export interface IVacationPeriodUsageData {
  periodStart: Date;
  periodEnd: Date;
  usage: IVacationUsageByType;
}

interface IVacationsUsageService {
  getCurrentVacationPeriodUsage(
    user: IUserViewModel,
  ): Promise<IVacationPeriodUsageData>;
}

@Injectable()
export class UserVacationsUsageService implements IVacationsUsageService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly teamsService: TeamsService,
    private readonly vacationPoliciesService: VacationPoliciesCacheService,
  ) {}

  public async getCurrentVacationPeriodUsage(user: IUserViewModel) {
    if (!user.contract_start_date) {
      throw new Error(
        `User ${user.email} does not have a contract start date.`,
      );
    }

    const { periodStart, periodEnd } = this.getCurrentVacationPeriod(
      user.contract_start_date,
    );

    const [vacationRequests, userTeam] = await Promise.all([
      this.vacationRequestsRepository.findMany({
        user_id: user.id,
        start_date: { operator: 'gte', value: getDateOnly(periodStart) },
        end_date: { operator: 'lte', value: getDateOnly(periodEnd) },
        status: {
          operator: 'in',
          value: [
            VacationRequestStatus.Approved,
            VacationRequestStatus.Pending,
          ],
        },
      }),
      this.teamsService.findOne({
        id: user.team_id,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    if (!userTeam) {
      throw new NotFoundException('User team not found.');
    }

    const teamVacationPolicy = await this.vacationPoliciesService.getById(
      userTeam.vacation_policy_id,
    );

    if (!teamVacationPolicy) {
      throw new NotFoundException(
        `Vacation policy for team ${user.team_id} not found.`,
      );
    }

    const carryoverDays = user.carryover_days || 0;
    const usage = this.getResult(vacationRequests, {
      vacationDays: carryoverDays + teamVacationPolicy.vacation_days,
      bonusDays: teamVacationPolicy.bonus_days,
      workingDays: carryoverDays + teamVacationPolicy.working_days,
    });

    return {
      periodStart,
      periodEnd,
      usage,
    };
  }

  private getResult(
    vacations: IVacationRequestViewModel[],
    daysAvailable: {
      vacationDays: number;
      bonusDays: number;
      workingDays: number;
    },
  ) {
    const result: IVacationUsageByType = {
      [VacationType.AnnualLeave]: {
        used: 0,
        available: daysAvailable.vacationDays,
        working_days_used: 0,
        working_days_available: daysAvailable.workingDays,
      },
      [VacationType.BonusDay]: { used: 0, available: daysAvailable.bonusDays },
      [VacationType.SickLeave]: { used: 0 },
      [VacationType.UnpaidLeave]: { used: 0 },
      [VacationType.Other]: { used: 0 },
    };

    for (const vacation of vacations) {
      const type = vacation.type;
      result[type].used += vacation.days;

      if (type === VacationType.AnnualLeave) {
        result[type].working_days_used += vacation.working_days;
        result[type].working_days_available -= vacation.working_days;
      }

      if (type === VacationType.AnnualLeave || type === VacationType.BonusDay) {
        result[type].available -= vacation.days;
      }
    }

    return result;
  }

  private getCurrentVacationPeriod(
    contractStartDate: string,
    today = new Date(),
  ) {
    const start = new Date(contractStartDate); // e.g. 2020-05-15
    const currentYear = today.getFullYear();

    const currentPeriodStart = new Date(
      currentYear,
      start.getMonth(),
      start.getDate(),
    );

    const periodStart =
      today >= currentPeriodStart
        ? currentPeriodStart
        : new Date(currentYear - 1, start.getMonth(), start.getDate());
    const periodEnd =
      today >= currentPeriodStart
        ? new Date(currentYear + 1, start.getMonth(), start.getDate() - 1)
        : new Date(currentYear, start.getMonth(), start.getDate() - 1);

    return { periodStart, periodEnd };
  }
}
