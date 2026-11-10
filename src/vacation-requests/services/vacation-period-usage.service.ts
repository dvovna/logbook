import { Injectable } from '@nestjs/common';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDateOnly } from '@common/utils/date.utils';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationType from '@common/enums/vacation-type.enum';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';

export interface IVacationDaysUsage {
  annualLeaveUsed: number;
  annualLeaveWorkingDaysUsed: number;
  bonusUsed: number;
  sickUsed: number;
  unpaidUsed: number;
  otherUsed: number;
}

// Counted from the requests every time: a cache went stale whenever requests,
// holidays or policies changed without a request event (a CSV import, for
// one), and one query per user is cheap.
@Injectable()
export class VacationPeriodUsageService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationDaysCalculationService: VacationDaysCalculationService,
  ) {}

  public async getPeriodUsage(
    user: IUserViewModel,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<IVacationDaysUsage> {
    const vacationRequests = await this.getVacationRequestsByPeriod(
      user,
      periodStart,
      periodEnd,
    );

    return this.aggregateVacationDays(
      await Promise.all(
        vacationRequests.map((vacation) =>
          this.getDaysInPeriod(vacation, periodStart, periodEnd),
        ),
      ),
    );
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

    // The holidays of the policy the request's team follows.
    const { vacationPolicyId } = await this.teamRulesService.forTeam(
      vacation.team_id,
      vacation.slack_team_id,
    );

    return {
      ...vacation,
      days: getDaysBetweenDates(new Date(start), new Date(end)),
      working_days: await this.vacationDaysCalculationService.calculate(
        new Date(start),
        new Date(end),
        vacationPolicyId,
        vacation.slack_team_id,
      ),
    };
  }

  private aggregateVacationDays(
    vacations: Pick<
      IVacationRequestViewModel,
      'type' | 'days' | 'working_days'
    >[],
  ): IVacationDaysUsage {
    return vacations.reduce<IVacationDaysUsage>(
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
