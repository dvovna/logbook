import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { getDateOnly } from 'src/common/utils/date.utils';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import {
  IVacationDaysCacheValue,
  VacationPeriodUsageCacheService,
} from 'src/vacation-requests/services/vacation-period-usage-cache.service';
import VacationType from 'src/common/enums/vacation-type.enum';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';

@Injectable()
export class VacationPeriodUsageService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly vacationPeriodUsageCacheService: VacationPeriodUsageCacheService,
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

    const aggregatedUsage = this.aggregateVacationDays(vacationRequests);

    await this.vacationPeriodUsageCacheService.set(
      user.id,
      periodStart,
      periodEnd,
      aggregatedUsage,
    );

    return aggregatedUsage;
  }

  private getVacationRequestsByPeriod(
    user: IUserViewModel,
    periodStart: Date,
    periodEnd: Date,
  ) {
    return this.vacationRequestsRepository.findMany({
      user_id: user.id,
      slack_team_id: user.slack_team_id,
      start_date: { operator: 'gte', value: getDateOnly(periodStart) },
      end_date: { operator: 'lte', value: getDateOnly(periodEnd) },
      status: {
        operator: 'in',
        value: [VacationRequestStatus.Approved, VacationRequestStatus.Pending],
      },
    });
  }

  private aggregateVacationDays(
    vacations: IVacationRequestViewModel[],
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
