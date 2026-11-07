import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ConfigService } from '@nestjs/config';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { ValidationError } from '@common/errors/validation.error';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { getDateOnly } from '@common/utils/date.utils';

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
    daysRequest: {
      calendarDays: number;
      workingDays: number;
    },
    vacationType: VacationType,
    user: IUserViewModel,
  ) {
    const { calendarDays, workingDays } = daysRequest;

    const usageData =
      await this.userVacationsUsageService.getCurrentVacationPeriodUsage(user);

    if (!usageData || !usageData.limits) {
      return;
    }

    const { usage } = usageData;

    switch (vacationType) {
      case VacationType.AnnualLeave: {
        const usageByType = usage[vacationType];

        this.validateVacationDaysUsage(
          calendarDays,
          usageByType.available,
          'vacation',
        );
        this.validateVacationDaysUsage(
          workingDays,
          usageByType.working_days_available,
          'working',
        );

        break;
      }
      case VacationType.BonusDay: {
        const usageByType = usage[vacationType];

        this.validateVacationDaysUsage(
          calendarDays,
          usageByType.available,
          'bonus',
        );

        break;
      }
      default:
        return;
    }
  }

  private validateVacationDaysUsage(
    daysRequested: number,
    daysAvailable: number,
    daysType: 'vacation' | 'working' | 'bonus' = 'vacation',
  ) {
    if (daysRequested > daysAvailable) {
      throw new ValidationError(
        `Not enough ${daysType} days. Requested: ${daysRequested}, available: ${daysAvailable}`,
        'dates',
      );
    }
  }
}
