import { Injectable } from '@nestjs/common';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { canSeeRates } from 'src/projects/constants/rate-roles';
import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import {
  scopeFilterOf,
  TimeEntriesScopeService,
} from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import {
  IAppliedFilters,
  IMissingTimeLine,
  IMissingTimeReport,
  ITimeReport,
  ITimeReportFilters,
  ITimeReportRow,
} from 'src/time-entries/types/time-report.types';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';

interface IReportParams {
  user: IUserViewModel;
  fromDate: string;
  toDate: string;
}

// What a group without a name of its own is called.
const UNNAMED: Record<TimeReportGrouping, string> = {
  [TimeReportGrouping.Client]: 'No client',
  [TimeReportGrouping.Project]: 'Unknown project',
  [TimeReportGrouping.Person]: 'Unknown user',
  [TimeReportGrouping.Team]: 'No team',
};

// Most time first, then by name.
const byTime = (a: ITimeReportRow, b: ITimeReportRow) =>
  b.minutes - a.minutes || a.name.localeCompare(b.name);

const emptyRow = (name: string, withAmount: boolean): ITimeReportRow => ({
  name,
  minutes: 0,
  billableMinutes: 0,
  approvedMinutes: 0,
  amount: withAmount ? 0 : null,
});

// Time reports: everything people logged in a period (drafts to approved,
// not deleted ones), by client, project, person or team, and who has not
// sent their time for approval. Each person sees only the time of their
// scope (TimeEntriesScopeService); amounts, at today's rates, only Admin
// and Finance (RATE_ROLES). The billing report, by contrast, counts approved
// time only. The database adds the time up: a year of a big workspace is
// hundreds of thousands of entries.
@Injectable()
export class TimeReportService {
  public constructor(
    private readonly scopeService: TimeEntriesScopeService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly clientsService: ClientsService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  // The filters narrow the entries of the viewer's scope (a client's
  // projects, a project, a person), after it, so no ID can widen it.
  public async getReport({
    user,
    groupBy,
    fromDate,
    toDate,
    filters = {},
  }: IReportParams & {
    groupBy: TimeReportGrouping;
    filters?: ITimeReportFilters;
  }): Promise<ITimeReport> {
    assertReportPeriod(fromDate, toDate);

    const withAmounts = canSeeRates(user.role);
    const [{ scope, groups }, names, currency] = await Promise.all([
      this.scopeService.scopeOf(user).then(async (scope) => ({
        scope,
        groups: await this.timeEntriesService.sumReportGroups(
          user.slack_team_id,
          {
            dateFrom: fromDate,
            dateTo: toDate,
            scope: scopeFilterOf(scope, user),
            filters,
          },
          groupBy,
        ),
      })),
      this.filterNames(user, filters),
      withAmounts
        ? this.slackTeamsService.getCurrency(user.slack_team_id)
        : null,
    ]);

    const rows = groups
      .map((group) => ({
        name: group.name ?? UNNAMED[groupBy],
        minutes: group.minutes,
        billableMinutes: group.billableMinutes,
        approvedMinutes: group.approvedMinutes,
        amount: withAmounts ? group.amount : null,
      }))
      .sort(byTime);
    const total = rows.reduce(
      (sum, row) => ({
        ...sum,
        minutes: sum.minutes + row.minutes,
        billableMinutes: sum.billableMinutes + row.billableMinutes,
        approvedMinutes: sum.approvedMinutes + row.approvedMinutes,
        amount: withAmounts ? (sum.amount ?? 0) + (row.amount ?? 0) : null,
      }),
      emptyRow('Total', withAmounts),
    );
    // As the entries' own names showed it: a person is named only when the
    // report has their time.
    const person = groups.length ? names.person : undefined;

    return {
      groupBy,
      fromDate,
      toDate,
      scope: scope.kind,
      filters: {
        ...(filters.clientId
          ? { client: names.client ?? 'Unknown client' }
          : {}),
        ...(filters.projectId
          ? { project: names.project ?? 'Unknown project' }
          : {}),
        ...(filters.userId ? { person: person ?? 'Unknown person' } : {}),
      } as IAppliedFilters,
      currency,
      rows,
      total,
      unratedMinutes: withAmounts
        ? groups.reduce((sum, group) => sum + group.unratedMinutes, 0)
        : null,
      entryCount: groups.reduce((sum, group) => sum + group.entries, 0),
    };
  }

  // The people `user` sees who logged nothing in the period, or still have
  // drafts or rejected entries in it. All their entries of the period count,
  // whatever team they were logged in.
  public async getMissingTime({
    user,
    fromDate,
    toDate,
  }: IReportParams): Promise<IMissingTimeReport> {
    assertReportPeriod(fromDate, toDate);

    const slackTeamId = user.slack_team_id;
    const { scope, people } = await this.scopeService.findPeople(user);
    const [sums, teams] = await Promise.all([
      this.timeEntriesService.sumOfUsers({
        slackTeamId,
        userIds: people.map(({ id }) => id),
        dateFrom: fromDate,
        dateTo: toDate,
      }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const teamNames = new Map(teams.map(({ id, name }) => [id, name]));
    const sumOf = new Map(sums.map((sum) => [sum.userId, sum]));
    const lines = people.map((person): IMissingTimeLine => ({
      name: person.name,
      teamName: person.team_id ? (teamNames.get(person.team_id) ?? null) : null,
      loggedMinutes: sumOf.get(person.id)?.minutes ?? 0,
      unsubmittedMinutes: sumOf.get(person.id)?.openMinutes ?? 0,
      unsubmittedCount: sumOf.get(person.id)?.openCount ?? 0,
    }));

    return {
      fromDate,
      toDate,
      scope: scope.kind,
      peopleCount: people.length,
      lines: lines
        .filter(
          ({ loggedMinutes, unsubmittedCount }) =>
            !loggedMinutes || unsubmittedCount,
        )
        .sort(
          (a, b) =>
            Number(!!a.loggedMinutes) - Number(!!b.loggedMinutes) ||
            b.unsubmittedMinutes - a.unsubmittedMinutes ||
            a.name.localeCompare(b.name),
        ),
    };
  }

  // The names of what the filters chose, where the workspace has it.
  private async filterNames(
    user: IUserViewModel,
    { clientId, projectId, userId }: ITimeReportFilters,
  ): Promise<IAppliedFilters> {
    const slackTeamId = user.slack_team_id;
    const [client, project, person] = await Promise.all([
      clientId
        ? this.clientsService.findOne({
            id: clientId,
            slackTeamId,
            includeArchived: true,
          })
        : null,
      projectId
        ? this.projectsService.findOne({
            id: projectId,
            slackTeamId,
            includeArchived: true,
          })
        : null,
      userId
        ? this.usersService.findOne({
            id: userId,
            slackTeamId,
            includeInactive: true,
          })
        : null,
    ]);

    return {
      client: client?.name,
      project: project?.name,
      person: person?.name,
    };
  }
}
