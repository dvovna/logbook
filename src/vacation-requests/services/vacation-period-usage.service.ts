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
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';

export interface IVacationDaysUsage {
  annualLeaveUsed: number;
  annualLeaveWorkingDaysUsed: number;
  bonusUsed: number;
  sickUsed: number;
  unpaidUsed: number;
  otherUsed: number;
}

export interface IVacationPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export interface IPeriodUsageOptions {
  // A request being edited, which the check counts with its new dates.
  excludeRequestId?: string;
  // The rules of the user's team, when the caller reads them anyway.
  ownRules?: Promise<IEffectiveTeamRules>;
}

// Counted from the requests every time, and their working days from the
// holidays as they are now: a request keeps the working days it had when it
// was made, which a holiday imported, added or switched off since makes
// wrong. One query for the requests, then one per team and per policy among
// them, however many periods.
@Injectable()
export class VacationPeriodUsageService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationDaysCalculationService: VacationDaysCalculationService,
  ) {}

  // The usage of each of `periods` (in order), from one read of the
  // requests of all of them.
  public async getUsageByPeriods(
    user: IUserViewModel,
    periods: IVacationPeriod[],
    { excludeRequestId, ownRules }: IPeriodUsageOptions = {},
  ): Promise<IVacationDaysUsage[]> {
    const from = periods[0].periodStart;
    const to = periods[periods.length - 1].periodEnd;
    const vacationRequests = await this.getVacationRequestsByPeriod(
      user,
      from,
      to,
      excludeRequestId,
    );
    const holidaysOfTeam = this.holidaysByTeam(user, from, to, ownRules);
    const requests = await Promise.all(
      vacationRequests.map(async (vacation) => ({
        vacation,
        holidayDates: await holidaysOfTeam(vacation.team_id),
      })),
    );

    return periods.map(({ periodStart, periodEnd }) =>
      this.aggregateVacationDays(
        requests
          .filter(
            ({ vacation }) =>
              vacation.start_date <= getDateOnly(periodEnd) &&
              vacation.end_date >= getDateOnly(periodStart),
          )
          .map(({ vacation, holidayDates }) =>
            this.getDaysInPeriod(
              vacation,
              periodStart,
              periodEnd,
              holidayDates,
            ),
          ),
      ),
    );
  }

  // Every request with days in the period, also one across its start or end.
  private getVacationRequestsByPeriod(
    user: IUserViewModel,
    periodStart: Date,
    periodEnd: Date,
    excludeRequestId: string | undefined,
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
      ...(excludeRequestId
        ? { id: { operator: 'neq', value: excludeRequestId } }
        : {}),
    });
  }

  // The period's holidays of the policy the team a request was filed in
  // follows, read once per team and once per policy.
  private holidaysByTeam(
    user: IUserViewModel,
    periodStart: Date,
    periodEnd: Date,
    ownRules: Promise<IEffectiveTeamRules> | undefined,
  ) {
    const byTeam = new Map<string, Promise<Set<string>>>();
    const byPolicy = new Map<string, Promise<Set<string>>>();

    const holidaysOfPolicy = (vacationPolicyId: string | null) => {
      const key = vacationPolicyId ?? '';

      if (!byPolicy.has(key)) {
        byPolicy.set(
          key,
          this.vacationDaysCalculationService.holidayDates(
            vacationPolicyId,
            user.slack_team_id,
            periodStart,
            periodEnd,
          ),
        );
      }

      return byPolicy.get(key)!;
    };

    return (teamId: string | null) => {
      const key = teamId ?? '';

      if (!byTeam.has(key)) {
        const rules =
          ownRules && key === (user.team_id ?? '')
            ? ownRules
            : this.teamRulesService.forTeam(teamId, user.slack_team_id);

        byTeam.set(
          key,
          rules.then(({ vacationPolicyId }) =>
            holidaysOfPolicy(vacationPolicyId),
          ),
        );
      }

      return byTeam.get(key)!;
    };
  }

  // A request counts with its days (and working days) inside the period.
  private getDaysInPeriod(
    vacation: IVacationRequestViewModel,
    periodStart: Date,
    periodEnd: Date,
    holidayDates: Set<string>,
  ) {
    const start = new Date(
      [vacation.start_date, getDateOnly(periodStart)].sort()[1],
    );
    const end = new Date([vacation.end_date, getDateOnly(periodEnd)].sort()[0]);

    return {
      type: vacation.type,
      days: getDaysBetweenDates(start, end),
      working_days: this.vacationDaysCalculationService.workingDatesWithout(
        start,
        end,
        holidayDates,
      ).length,
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
            acc.bonusUsed += vacation.working_days;
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
