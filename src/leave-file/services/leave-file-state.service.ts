import { Injectable } from '@nestjs/common';
import { getDateOnly } from '@common/utils/date.utils';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { vacationPolicyOfTeam } from '@modules/teams/utils/team-rules.utils';
import { UsersService } from '@modules/users/services/users.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { VacationPeriodUsageService } from '@modules/vacation-requests/services/vacation-period-usage.service';
import { toStoredBalance } from '@modules/vacation-requests/utils/leave-balance.utils';
import {
  parseFileDate,
  slashOrderOf,
} from 'src/leave-file/parsers/leave-file-values';
import { IStoredLeaveBalancesState } from 'src/leave-file/types/leave-balances-plan.interface';
import { ILeaveHistoryRow } from 'src/leave-file/types/leave-file-row.interface';
import { ILeaveHistoryState } from 'src/leave-file/types/leave-history-plan.interface';

// The requests are read from two years before today to two years after it,
// and further back for older leave in a history file. The carryover into
// today's year needs the year before it; a chain from a year further back
// counts that year without its requests.
const YEARS_AROUND_TODAY = 2;

const yearsFrom = (date: string, years: number) => {
  const moved = new Date(date);
  moved.setUTCFullYear(moved.getUTCFullYear() + years);

  return moved;
};

// What the leave file planners read of the workspace, at once.
@Injectable()
export class LeaveFileStateService {
  public constructor(
    private readonly usersService: UsersService,
    private readonly teamRulesService: TeamRulesService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly periodUsageService: VacationPeriodUsageService,
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly daysCalculationService: VacationDaysCalculationService,
  ) {}

  // A usable Balance on falls in the person's current vacation year and not
  // after today, so the years around today hold every one in the file.
  public async balancesState(
    slackTeamId: string,
  ): Promise<IStoredLeaveBalancesState> {
    const today = getDateOnly(new Date());
    const { state } = await this.read(
      slackTeamId,
      today,
      yearsFrom(today, -YEARS_AROUND_TODAY),
      yearsFrom(today, YEARS_AROUND_TODAY),
    );

    return state;
  }

  public async historyState(
    slackTeamId: string,
    rows: ILeaveHistoryRow[],
  ): Promise<ILeaveHistoryState> {
    const today = getDateOnly(new Date());
    const order = slashOrderOf(rows.flatMap(({ from, to }) => [from, to]));
    const dates = rows
      .flatMap(({ from, to }) => [
        parseFileDate(from, order),
        parseFileDate(to, order),
      ])
      .flatMap((date) => (date.kind === 'date' ? [date.value] : []))
      .sort();
    const from = yearsFrom(today, -YEARS_AROUND_TODAY);
    const to = yearsFrom(today, YEARS_AROUND_TODAY);
    const earliest = dates.length ? new Date(dates[0]) : from;
    const latest = dates.length ? new Date(dates[dates.length - 1]) : to;
    const start = earliest < from ? earliest : from;
    const end = latest > to ? latest : to;
    const [{ state, policyIdOf }, holidays] = await Promise.all([
      this.read(slackTeamId, today, start, end),
      this.daysCalculationService.holidayDatesByPolicy(slackTeamId, start, end),
    ]);
    const teamOf = new Map(
      state.people.map(({ id, team_id }) => [id, team_id]),
    );

    return {
      ...state,
      // A leave goes to the person's current team (D22), so its working
      // days are counted with the holidays of that team's policy.
      workingDatesOf: (userId, startDate, endDate) => {
        const policyId = policyIdOf(teamOf.get(userId));

        return this.daysCalculationService.workingDatesWithout(
          new Date(startDate),
          new Date(endDate),
          (policyId && holidays.get(policyId)) || new Set(),
        );
      },
    };
  }

  // The requests and balances only of active people: the planners use no
  // row of anyone else.
  private async read(slackTeamId: string, today: string, from: Date, to: Date) {
    const readingPeople = this.usersService.findMany({
      slackTeamId,
      includeInactive: true,
    });
    const readingActive = readingPeople.then((people) =>
      people.filter(({ is_active }) => is_active),
    );
    const [people, rules, policies, requestsOf, balances] = await Promise.all([
      readingPeople,
      this.teamRulesService.forWorkspace(slackTeamId),
      this.vacationPoliciesService.findMany({ slackTeamId }),
      readingActive.then((active) =>
        this.periodUsageService.countedRequestsOfUsers(active, from, to),
      ),
      readingActive.then((active) =>
        this.leaveBalancesService.findOfUsers(
          active.map(({ id }) => id),
          slackTeamId,
        ),
      ),
    ]);
    const policyIdOf = vacationPolicyOfTeam(rules);
    const policyById = new Map(policies.map((policy) => [policy.id, policy]));
    const state: IStoredLeaveBalancesState = {
      today,
      people,
      policyOf: new Map(
        people.map(({ id, team_id }) => [
          id,
          policyById.get(policyIdOf(team_id) ?? '') ?? null,
        ]),
      ),
      requestsOf,
      balanceOf: new Map(
        balances.map((balance) => [balance.user_id, toStoredBalance(balance)]),
      ),
    };

    return { state, policyIdOf };
  }
}
