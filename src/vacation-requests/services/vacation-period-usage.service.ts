import { Injectable } from '@nestjs/common';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { vacationPolicyOfTeam } from '@modules/teams/utils/team-rules.utils';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDateOnly } from '@common/utils/date.utils';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { ICountedRequest } from '@modules/vacation-requests/utils/leave-balance.utils';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';

export interface IPeriodUsageOptions {
  // A request being edited, which the check counts with its new dates.
  excludeRequestId?: string;
  // The rules of the user's team, when the caller reads them anyway.
  ownRules?: Promise<IEffectiveTeamRules>;
}

// The requests that count against a balance, read every time, and their
// working days from the holidays as they are now: a request keeps the
// working days it had when it was made, which a holiday imported, added or
// switched off since makes wrong.
@Injectable()
export class VacationPeriodUsageService {
  public constructor(
    private readonly vacationRequestsRepository: VacationRequestsRepository,
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationDaysCalculationService: VacationDaysCalculationService,
  ) {}

  // The user's requests with days from `from` to `to`, each with its working
  // dates in that span. One query for the requests, then one per team and
  // per policy among them.
  public async countedRequests(
    user: IUserViewModel,
    from: Date,
    to: Date,
    { excludeRequestId, ownRules }: IPeriodUsageOptions = {},
  ): Promise<ICountedRequest[]> {
    const vacationRequests = await this.findCounted(
      user.id,
      user.slack_team_id,
      from,
      to,
      excludeRequestId,
    );
    const holidaysOfTeam = this.holidaysByTeam(user, from, to, ownRules);

    return Promise.all(
      vacationRequests.map(async (vacation) =>
        this.counted(
          vacation,
          from,
          to,
          await holidaysOfTeam(vacation.team_id),
        ),
      ),
    );
  }

  // countedRequests of people of one workspace, by user ID: one query for
  // the requests, one for the rules of every team and one for the holidays,
  // however many people.
  public async countedRequestsOfUsers(
    users: IUserViewModel[],
    from: Date,
    to: Date,
  ): Promise<Map<string, ICountedRequest[]>> {
    const byUser = new Map(
      users.map(({ id }) => [id, [] as ICountedRequest[]]),
    );

    if (!users.length) {
      return byUser;
    }

    const slackTeamId = users[0].slack_team_id;
    const [vacationRequests, rules, holidays] = await Promise.all([
      this.findCounted(
        users.map(({ id }) => id),
        slackTeamId,
        from,
        to,
      ),
      this.teamRulesService.forWorkspace(slackTeamId),
      this.vacationDaysCalculationService.holidayDatesByPolicy(
        slackTeamId,
        from,
        to,
      ),
    ]);
    const policyOf = vacationPolicyOfTeam(rules);

    for (const vacation of vacationRequests) {
      const policyId = policyOf(vacation.team_id);

      byUser
        .get(vacation.user_id)
        ?.push(
          this.counted(
            vacation,
            from,
            to,
            (policyId && holidays.get(policyId)) || new Set(),
          ),
        );
    }

    return byUser;
  }

  // Every request with days in the span, also one across its start or end.
  private findCounted(
    userIds: string | string[],
    slackTeamId: string,
    from: Date,
    to: Date,
    excludeRequestId?: string,
  ) {
    return this.vacationRequestsRepository.findMany({
      user_id: userIds,
      slack_team_id: slackTeamId,
      start_date: { operator: 'lte', value: getDateOnly(to) },
      end_date: { operator: 'gte', value: getDateOnly(from) },
      status: {
        operator: 'in',
        value: [VacationRequestStatus.Approved, VacationRequestStatus.Pending],
      },
      ...(excludeRequestId
        ? { id: { operator: 'neq', value: excludeRequestId } }
        : {}),
    });
  }

  // The holidays are read for the span only, so the working dates are too.
  private counted(
    vacation: IVacationRequestViewModel,
    from: Date,
    to: Date,
    holidayDates: Set<string>,
  ): ICountedRequest {
    const start = new Date([vacation.start_date, getDateOnly(from)].sort()[1]);
    const end = new Date([vacation.end_date, getDateOnly(to)].sort()[0]);

    return {
      id: vacation.id,
      status: vacation.status,
      type: vacation.type,
      startDate: vacation.start_date,
      endDate: vacation.end_date,
      workingDates: this.vacationDaysCalculationService.workingDatesWithout(
        start,
        end,
        holidayDates,
      ),
    };
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
}
