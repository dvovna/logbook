import { Injectable } from '@nestjs/common';
import TeamsService from '@modules/teams/services/teams.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDateOnly } from '@common/utils/date.utils';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import {
  IVacationDaysCacheValue,
  VacationPeriodUsageCacheService,
} from '@modules/vacation-requests/services/vacation-period-usage-cache.service';
import VacationType from '@common/enums/vacation-type.enum';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';

@Injectable()
export class VacationPeriodUsageService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly vacationPeriodUsageCacheService: VacationPeriodUsageCacheService,
    private readonly teamsService: TeamsService,
    private readonly vacationDaysCalculationService: VacationDaysCalculationService,
  ) {}

  public async getPeriodUsage(
    user: IUserViewModel,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const cachedUsage = await this.vacationPeriodUsageCacheService.get(
      user.id,
      periodStart,
      periodEnd,
    );

    if (cachedUsage) {
      return cachedUsage;
    }

    const vacationRequests = await this.getVacationRequestsByPeriod(
      user,
      periodStart,
      periodEnd,
    );

    const aggregatedUsage = this.aggregateVacationDays(
      await Promise.all(
        vacationRequests.map((vacation) =>
          this.getDaysInPeriod(vacation, periodStart, periodEnd),
        ),
      ),
    );

    await this.vacationPeriodUsageCacheService.set(
      user.id,
      periodStart,
      periodEnd,
      aggregatedUsage,
    );

    return aggregatedUsage;
  }

  // Every request with days in the period, also one across its start or end.
  private getVacationRequestsByPeriod(
    user: IUserViewModel,
    periodStart: Date,
    periodEnd: Date,
  ) {
    return this.vacationRequestsRepository.findMany({
      user_id: user.id,
      slack_team_id: user.slack_team_id,
      start_date: { operator: 'lte', value: getDateOnly(periodEnd) },
      end_date: { operator: 'gte', value: getDateOnly(periodStart) },
      status: {
        operator: 'in',
        value: [VacationRequestStatus.Approved, VacationRequestStatus.Pending],
      },
    });
  }

  // A request inside the period counts with its days; one across its start
  // or end only with the days (and working days) inside it.
  private async getDaysInPeriod(
    vacation: IVacationRequestViewModel,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const start = [vacation.start_date, getDateOnly(periodStart)].sort()[1];
    const end = [vacation.end_date, getDateOnly(periodEnd)].sort()[0];

    if (start === vacation.start_date && end === vacation.end_date) {
      return vacation;
    }

    const team = vacation.team_id
      ? await this.teamsService.findOne({
        id: vacation.team_id,
        slackTeamId: vacation.slack_team_id,
      })
      : null;

    return {
      ...vacation,
      days: getDaysBetweenDates(new Date(start), new Date(end)),
      working_days: await this.vacationDaysCalculationService.calculate(
        new Date(start),
        new Date(end),
        team?.vacation_policy_id ?? null,
        vacation.slack_team_id,
      ),
    };
  }

  private aggregateVacationDays(
    vacations: Pick<IVacationRequestViewModel, 'type' | 'days' | 'working_days'>[],
  ): IVacationDaysCacheValue {
    return vacations.reduce<IVacationDaysCacheValue>(
      (acc, vacation) => {
        switch (vacation.type) {
          case VacationType.AnnualLeave:
            acc.annualLeaveUsed += vacation.days;
            acc.annualLeaveWorkingDaysUsed += vacation.working_days;
            break;
          case VacationType.BonusDay:
            acc.bonusUsed += vacation.days;
            break;
          case VacationType.SickLeave:
            acc.sickUsed += vacation.days;
            break;
          case VacationType.UnpaidLeave:
            acc.unpaidUsed += vacation.days;
            break;
          case VacationType.Other:
            acc.otherUsed += vacation.days;
            break;
        }
        return acc;
      },
      {
        annualLeaveUsed: 0,
        annualLeaveWorkingDaysUsed: 0,
        bonusUsed: 0,
        sickUsed: 0,
        unpaidUsed: 0,
        otherUsed: 0,
      },
    );
  }
}
