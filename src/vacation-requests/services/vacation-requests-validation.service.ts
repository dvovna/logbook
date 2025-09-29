import { Injectable } from '@nestjs/common';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { ConfigService } from '@nestjs/config';
import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationType from 'src/common/enums/vacation-type.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';

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
      );
    }
  }
}
