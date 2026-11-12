import { formatDate, formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ConfigService } from '@nestjs/config';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { ValidationError } from '@common/errors/validation.error';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { getDateOnly } from '@common/utils/date.utils';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import { getVacationPeriodsBetween } from '@modules/vacation-requests/utils/vacation-period.utils';

// A request's dates and its working days ('YYYY-MM-DD'), which the check
// splits by vacation year.
export interface IRequestedDays {
  startDate: Date;
  endDate: Date;
  workingDates: string[];
}

export const ACTIVE_REQUEST_STATUSES = [
  VacationRequestStatus.Pending,
  VacationRequestStatus.Approved,
];

@Injectable()
export class VacationRequestsValidationService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly userVacationsUsageService: VacationsUsageService,
    private readonly config: ConfigService,
  ) {}

  public async validateRequestLimits(userId: string, slackTeamId: string) {
    const userRequests = await this.vacationRequestsRepository.findMany({
      user_id: userId,
      slack_team_id: slackTeamId,
    });

    const maxRequestsLimit = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxRequestsPerUser,
    );

    if (userRequests.length >= maxRequestsLimit) {
      throw new ValidationError(
        `Max vacation requests limit reached (${maxRequestsLimit})`,
      );
    }

    const pendingRequests = userRequests.filter(
      (request) => request.status === VacationRequestStatus.Pending,
    );

    const maxPendingRequestsLimit = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxPendingRequestsPerUser,
    );

    if (pendingRequests.length >= maxPendingRequestsLimit) {
      throw new ValidationError(
        `Max opened vacation requests limit reached (${maxPendingRequestsLimit})`,
      );
    }
  }

  // A user can't have two pending or approved requests covering the same day.
  public async validateNoOverlap({
    userId,
    slackTeamId,
    startDate,
    endDate,
    excludeRequestId,
  }: {
    userId: string;
    slackTeamId: string;
    startDate: Date;
    endDate: Date;
    excludeRequestId?: string;
  }) {
    const [overlapping] = await this.vacationRequestsRepository.findMany({
      user_id: userId,
      slack_team_id: slackTeamId,
      status: { operator: 'in', value: ACTIVE_REQUEST_STATUSES },
      start_date: { operator: 'lte', value: getDateOnly(endDate) },
      end_date: { operator: 'gte', value: getDateOnly(startDate) },
      ...(excludeRequestId
        ? { id: { operator: 'neq', value: excludeRequestId } }
        : {}),
    });

    if (overlapping) {
      throw new ValidationError(
        `These dates overlap with another vacation request (${formatDateRange(overlapping.start_date, overlapping.end_date)})`,
        'dates',
      );
    }
  }

  public async validateDaysRequested(
    request: IRequestedDays,
    vacationType: VacationType,
    user: IUserViewModel,
  ) {
    this.checkDaysRequested(
      request,
      vacationType,
      await this.getUsage(user, request),
    );
  }

  // validateDaysRequested in two steps, for a caller that reads the balance
  // while it counts the working days: the read, then the check. The balance
  // of every vacation year the dates touch, without the request being
  // edited (`excludeRequestId`), which would otherwise count twice.
  public getUsage(
    user: IUserViewModel,
    { startDate, endDate }: Pick<IRequestedDays, 'startDate' | 'endDate'>,
    { excludeRequestId }: { excludeRequestId?: string } = {},
  ): Promise<IVacationPeriodUsageData[]> {
    return Promise.all(
      getVacationPeriodsBetween(
        user.contract_start_date,
        startDate,
        endDate,
      ).map(({ periodStart }) =>
        this.userVacationsUsageService.getVacationPeriodUsage(
          user,
          periodStart,
          { excludeRequestId },
        ),
      ),
    );
  }

  // Each vacation year with the request's days in it.
  public checkDaysRequested(
    { startDate, endDate, workingDates }: IRequestedDays,
    vacationType: VacationType,
    usageByPeriod: IVacationPeriodUsageData[],
  ) {
    const today = getDateOnly(new Date());
    const start = getDateOnly(startDate);
    const end = getDateOnly(endDate);

    for (const { periodStart, periodEnd, usage, limits } of usageByPeriod) {
      if (!limits) {
        continue;
      }

      const from = [start, getDateOnly(periodStart)].sort()[1];
      const to = [end, getDateOnly(periodEnd)].sort()[0];
      const { correction } = limits;
      // A unit a file balance gave is what was left on its day before any
      // leave from that day on: the request takes from it only its days from
      // then on, and nothing when it ends before.
      const firstDayIn = (unit: 'days' | 'workingDays' | 'bonusDays') =>
        correction && correction[unit] !== null && correction.balanceOn > from
          ? correction.balanceOn
          : from;
      const calendarDays = (first: string) =>
        first > to ? 0 : getDaysBetweenDates(new Date(first), new Date(to));
      const workingDays = (first: string) =>
        workingDates.filter((date) => date >= first && date <= to).length;
      // A year other than the current one is named: its balance is not the
      // one Home shows.
      const year =
        getDateOnly(periodStart) <= today && today <= getDateOnly(periodEnd)
          ? ''
          : ` in the vacation year from ${formatDate(periodStart)}`;

      switch (vacationType) {
        case VacationType.AnnualLeave: {
          const usageByType = usage[vacationType];

          this.validateVacationDaysUsage(
            calendarDays(firstDayIn('days')),
            usageByType.available,
            'vacation',
            year,
          );
          this.validateVacationDaysUsage(
            workingDays(firstDayIn('workingDays')),
            usageByType.working_days_available,
            'working',
            year,
          );

          break;
        }
        // Bonus days are working days: a Friday to Monday request takes 2.
        case VacationType.BonusDay: {
          const usageByType = usage[vacationType];

          this.validateVacationDaysUsage(
            workingDays(firstDayIn('bonusDays')),
            usageByType.available,
            'bonus',
            year,
          );

          break;
        }
        default:
          return;
      }
    }
  }

  private validateVacationDaysUsage(
    daysRequested: number,
    daysAvailable: number,
    daysType: 'vacation' | 'working' | 'bonus',
    year: string,
  ) {
    if (daysRequested > daysAvailable) {
      throw new ValidationError(
        `Not enough ${daysType} days${year}. Requested: ${daysRequested}, available: ${daysAvailable}`,
        'dates',
      );
    }
  }
}
