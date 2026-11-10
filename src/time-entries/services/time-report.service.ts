import { Injectable } from '@nestjs/common';
import { amountInCents } from '@common/utils/money.utils';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { canSeeRates } from 'src/projects/constants/rate-roles';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { OPEN_TIME_ENTRY_STATUSES } from 'src/time-entries/constants/open-time-entry-statuses';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import {
  TimeEntriesScopeService,
  TimeScopeKind,
} from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';

export enum TimeReportGrouping {
  Client = 'client',
  Project = 'project',
  Person = 'person',
  Team = 'team',
}

// A client's, project's, person's or team's time in the period.
export interface ITimeReportRow {
  name: string;
  minutes: number;
  billableMinutes: number;
  approvedMinutes: number;
  // In cents, of the billable time that has a rate; null for those who don't
  // see amounts (RATE_ROLES).
  amount: number | null;
}

export interface ITimeReport {
  groupBy: TimeReportGrouping;
  fromDate: string;
  toDate: string;
  scope: TimeScopeKind;
  // The workspace's currency; null for those who don't see amounts.
  currency: string | null;
  // Most time first.
  rows: ITimeReportRow[];
  total: ITimeReportRow;
  // Billable time without a rate, so without an amount; null for those who
  // don't see amounts.
  unratedMinutes: number | null;
}

// A person who has not sent all their time of the period for approval.
export interface IMissingTimeLine {
  name: string;
  teamName: string | null;
  // Everything they logged in the period, whatever its status.
  loggedMinutes: number;
  // Drafts and rejected entries: not sent for approval (again) yet.
  unsubmittedMinutes: number;
  unsubmittedCount: number;
}

export interface IMissingTimeReport {
  fromDate: string;
  toDate: string;
  scope: TimeScopeKind;
  // Everyone the viewer sees, listed or not.
  peopleCount: number;
  // Who logged nothing first, then most unsubmitted time.
  lines: IMissingTimeLine[];
}

interface IReportParams {
  user: IUserViewModel;
  fromDate: string;
  toDate: string;
}

interface IClientRef {
  id: string;
  name: string;
}

const NO_CLIENT = 'No client';
const NO_TEAM = 'No team';

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

// The rate billable time of `userId` on `projectId` is worth: the person's
// own rate on the project, else the project's; null if neither.
export const rateOf = (
  rates: Map<string, IProjectRates>,
  projectId: string,
  userId: string,
) => {
  const projectRates = rates.get(projectId);
  const ownRate = projectRates?.personRates.find(
    (rate) => rate.userId === userId,
  );

  return ownRate?.hourlyRate ?? projectRates?.hourlyRate ?? null;
};

// Time reports: everything people logged in a period (drafts to approved,
// not deleted ones), by client, project, person or team, and who has not
// sent their time for approval. Each person sees only the time of their
// scope (TimeEntriesScopeService); amounts, at today's rates, only Admin
// and HR. The billing report, by contrast, counts approved time only.
@Injectable()
export class TimeReportService {
  public constructor(
    private readonly scopeService: TimeEntriesScopeService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly projectRatesService: ProjectRatesService,
    private readonly clientsService: ClientsService,
    private readonly teamsService: TeamsService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  public async getReport({
    user,
    groupBy,
    fromDate,
    toDate,
  }: IReportParams & { groupBy: TimeReportGrouping }): Promise<ITimeReport> {
    assertReportPeriod(fromDate, toDate);

    const withAmounts = canSeeRates(user.role);
    const { scope, entries } = await this.scopeService.findEntries(user, {
      dateFrom: fromDate,
      dateTo: toDate,
    });
    const projectIds = [...new Set(entries.map((entry) => entry.project_id))];
    const [rates, currency, groupOf] = await Promise.all([
      withAmounts && projectIds.length
        ? this.projectRatesService.findRates(projectIds, user)
        : new Map<string, IProjectRates>(),
      withAmounts
        ? this.slackTeamsService.getCurrency(user.slack_team_id)
        : null,
      this.grouper(groupBy, user, projectIds),
    ]);

    const rows = new Map<string, ITimeReportRow>();
    // A group's billable minutes by project and person, which have one rate.
    const billable = new Map<string, number>();

    for (const entry of entries) {
      const group = groupOf(entry);
      const row = rows.get(group.key) ?? emptyRow(group.name, withAmounts);

      row.minutes += entry.minutes;
      row.approvedMinutes +=
        entry.status === TimeEntryStatus.Approved ? entry.minutes : 0;

      if (entry.billable) {
        const key = [group.key, entry.project_id, entry.user_id].join('\n');

        row.billableMinutes += entry.minutes;
        billable.set(key, (billable.get(key) ?? 0) + entry.minutes);
      }

      rows.set(group.key, row);
    }

    let unratedMinutes = 0;

    // Amounts per project and person, then added up, as the billing report
    // does, so the two round alike.
    if (withAmounts) {
      for (const [key, minutes] of billable) {
        const [groupKey, projectId, userId] = key.split('\n');
        const rate = rateOf(rates, projectId, userId);
        const row = rows.get(groupKey)!;

        if (rate === null) {
          unratedMinutes += minutes;
        } else {
          row.amount = (row.amount ?? 0) + amountInCents(minutes, rate);
        }
      }
    }

    const sorted = [...rows.values()].sort(byTime);
    const total = sorted.reduce(
      (sum, row) => ({
        ...sum,
        minutes: sum.minutes + row.minutes,
        billableMinutes: sum.billableMinutes + row.billableMinutes,
        approvedMinutes: sum.approvedMinutes + row.approvedMinutes,
        amount: withAmounts ? (sum.amount ?? 0) + (row.amount ?? 0) : null,
      }),
      emptyRow('Total', withAmounts),
    );

    return {
      groupBy,
      fromDate,
      toDate,
      scope: scope.kind,
      currency,
      rows: sorted,
      total,
      unratedMinutes: withAmounts ? unratedMinutes : null,
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
    const [entries, teams] = await Promise.all([
      this.timeEntriesService.findMany({
        slackTeamId,
        userIds: people.map(({ id }) => id),
        dateFrom: fromDate,
        dateTo: toDate,
      }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const teamNames = new Map(teams.map(({ id, name }) => [id, name]));
    const lines = new Map<string, IMissingTimeLine>(
      people.map((person) => [
        person.id,
        {
          name: person.name,
          teamName: person.team_id
            ? (teamNames.get(person.team_id) ?? null)
            : null,
          loggedMinutes: 0,
          unsubmittedMinutes: 0,
          unsubmittedCount: 0,
        },
      ]),
    );

    for (const entry of entries) {
      const line = lines.get(entry.user_id);

      if (!line) {
        continue;
      }

      line.loggedMinutes += entry.minutes;

      if (OPEN_TIME_ENTRY_STATUSES.includes(entry.status)) {
        line.unsubmittedMinutes += entry.minutes;
        line.unsubmittedCount += 1;
      }
    }

    return {
      fromDate,
      toDate,
      scope: scope.kind,
      peopleCount: people.length,
      lines: [...lines.values()]
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

  // The group an entry is counted in: its key and the name to show.
  private async grouper(
    groupBy: TimeReportGrouping,
    user: IUserViewModel,
    projectIds: string[],
  ): Promise<(entry: ITimeEntryViewModel) => { key: string; name: string }> {
    switch (groupBy) {
      case TimeReportGrouping.Client: {
        // By the project's client rather than the entry's client_id, which
        // entries logged before it was filled in do not have.
        const clientOf = await this.clientsByProject(user, projectIds);

        return (entry) => {
          const client = clientOf.has(entry.project_id)
            ? clientOf.get(entry.project_id)
            : entry.client;

          return client
            ? { key: client.id, name: client.name }
            : { key: '', name: NO_CLIENT };
        };
      }
      case TimeReportGrouping.Project:
        return (entry) => ({
          key: entry.project_id,
          name: entry.project?.name ?? 'Unknown project',
        });
      case TimeReportGrouping.Person:
        return (entry) => ({
          key: entry.user_id,
          name: entry.user?.name ?? 'Unknown user',
        });
      case TimeReportGrouping.Team:
        return (entry) =>
          entry.team
            ? { key: entry.team.id, name: entry.team.name }
            : { key: '', name: NO_TEAM };
    }
  }

  // Each project's client (archived ones included), or null, by project ID.
  public async clientsByProject(user: IUserViewModel, projectIds: string[]) {
    const slackTeamId = user.slack_team_id;
    const [projects, clients] = await Promise.all([
      projectIds.length
        ? this.projectsService.findMany({
            slackTeamId,
            ids: projectIds,
            includeArchived: true,
          })
        : [],
      this.clientsService.findMany({ slackTeamId, includeArchived: true }),
    ]);
    const clientsById = new Map(
      clients.map(({ id, name }) => [id, { id, name }]),
    );

    return new Map(
      projects.map((project): [string, IClientRef | null] => [
        project.id,
        (project.client_id && clientsById.get(project.client_id)) || null,
      ]),
    );
  }
}
