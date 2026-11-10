import { canSeeRates } from 'src/projects/constants/rate-roles';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { amountInCents } from '@common/utils/money.utils';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// One person's approved time on one project, and what it comes to.
export interface IBillingLine {
  projectName: string;
  personName: string;
  minutes: number;
  billableMinutes: number;
  // The person's own rate on the project, else the project's; null if none.
  hourlyRate: number | null;
  // The billable time at the rate, in cents; null without a rate or without
  // billable time.
  amount: number | null;
}

// A project's or a person's lines added up.
export interface IBillingTotal {
  name: string;
  minutes: number;
  billableMinutes: number;
  // In cents, of the billable time that has a rate.
  amount: number;
  // Billable time without a rate, so without an amount.
  unratedMinutes: number;
}

export interface IBillingReport {
  clientName: string;
  fromDate: string;
  toDate: string;
  currency: string;
  approvedMinutes: number;
  billableMinutes: number;
  // Drafts, submitted and rejected entries: not billed until approved.
  unapprovedMinutes: number;
  // Approved time already in billing snapshots; the rest can go into one.
  snapshotMinutes: number;
  // In cents, of the billable time that has a rate.
  amount: number;
  unratedMinutes: number;
  // By project (most time first), then by person.
  lines: IBillingLine[];
  byProject: IBillingTotal[];
  byPerson: IBillingTotal[];
}

interface IReportParams {
  user: IUserViewModel;
  clientId: string;
  fromDate: string;
  toDate: string;
}

const NOT_YET_APPROVED = [
  TimeEntryStatus.Draft,
  TimeEntryStatus.Submitted,
  TimeEntryStatus.Rejected,
];

const sumMinutes = (entries: ITimeEntryViewModel[]) =>
  entries.reduce((sum, { minutes }) => sum + minutes, 0);

const sumOf = <T>(items: T[], valueOf: (item: T) => number) =>
  items.reduce((sum, item) => sum + valueOf(item), 0);

// Most time first, then by name.
const byTime = <T extends { minutes: number; name: string }>(a: T, b: T) =>
  b.minutes - a.minutes || a.name.localeCompare(b.name);

interface ILineWithKeys extends IBillingLine {
  projectId: string;
  userId: string;
}

// The lines added up by `keyOf`, most time first.
const totals = (
  lines: ILineWithKeys[],
  keyOf: (line: ILineWithKeys) => string,
  nameOf: (line: ILineWithKeys) => string,
): (IBillingTotal & { key: string })[] => {
  const groups = new Map<string, IBillingTotal & { key: string }>();

  for (const line of lines) {
    const key = keyOf(line);
    const total = groups.get(key) ?? {
      key,
      name: nameOf(line),
      minutes: 0,
      billableMinutes: 0,
      amount: 0,
      unratedMinutes: 0,
    };

    total.minutes += line.minutes;
    total.billableMinutes += line.billableMinutes;
    total.amount += line.amount ?? 0;
    total.unratedMinutes += line.hourlyRate === null ? line.billableMinutes : 0;
    groups.set(key, total);
  }

  return [...groups.values()].sort(byTime);
};

// What to bill a client for a period: approved time on the client's
// projects (archived ones included), by project and person, at today's
// rates, and how much of it billing snapshots hold already (at the rates
// they froze, which the report doesn't show). A person's own rate on a project replaces the project's; billable
// time without either has no amount and is counted apart. Admin and Finance only.
@Injectable()
export class BillingReportService {
  public constructor(
    private readonly clientsService: ClientsService,
    private readonly projectsService: ProjectsService,
    private readonly projectRatesService: ProjectRatesService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  public async getClientReport({
    user,
    clientId,
    fromDate,
    toDate,
  }: IReportParams): Promise<IBillingReport> {
    if (!canSeeRates(user.role)) {
      throw new ForbiddenException(
        'Only Admin and Finance make billing reports.',
      );
    }

    const slackTeamId = user.slack_team_id;
    const client = await this.clientsService.findOne({
      id: clientId,
      slackTeamId,
      includeArchived: true,
    });

    if (!client) {
      throw new ValidationError('Client not found.');
    }

    // By project rather than the entry's client_id, which entries logged
    // before it was filled in do not have.
    const projects = await this.projectsService.findMany({
      slackTeamId,
      clientId,
      includeArchived: true,
    });
    const projectIds = projects.map(({ id }) => id);
    const [entries, rates, currency] = await Promise.all([
      projects.length
        ? this.timeEntriesService.findMany({
            slackTeamId,
            projectIds,
            dateFrom: fromDate,
            dateTo: toDate,
          })
        : [],
      this.projectRatesService.findRates(projectIds, user),
      this.slackTeamsService.getCurrency(slackTeamId),
    ]);
    const approved = entries.filter(
      ({ status }) => status === TimeEntryStatus.Approved,
    );
    const billed = await this.timeEntriesService.findBilledIds(
      slackTeamId,
      approved.map(({ id }) => id),
    );
    const projectNames = new Map(projects.map(({ id, name }) => [id, name]));

    const rateOf = (projectId: string, userId: string) => {
      const projectRates = rates.get(projectId);
      const ownRate = projectRates?.personRates.find(
        (rate) => rate.userId === userId,
      );

      return ownRate?.hourlyRate ?? projectRates?.hourlyRate ?? null;
    };

    const lines = new Map<string, ILineWithKeys>();

    for (const entry of approved) {
      const key = `${entry.project_id}:${entry.user_id}`;
      const line = lines.get(key) ?? {
        projectId: entry.project_id,
        userId: entry.user_id,
        projectName: projectNames.get(entry.project_id) ?? 'Unknown project',
        personName: entry.user?.name ?? 'Unknown user',
        minutes: 0,
        billableMinutes: 0,
        hourlyRate: rateOf(entry.project_id, entry.user_id),
        amount: null,
      };

      line.minutes += entry.minutes;
      line.billableMinutes += entry.billable ? entry.minutes : 0;
      lines.set(key, line);
    }

    for (const line of lines.values()) {
      line.amount =
        line.hourlyRate !== null && line.billableMinutes
          ? amountInCents(line.billableMinutes, line.hourlyRate)
          : null;
    }

    const allLines = [...lines.values()];
    const byProject = totals(
      allLines,
      ({ projectId }) => projectId,
      ({ projectName }) => projectName,
    );
    const byPerson = totals(
      allLines,
      ({ userId }) => userId,
      ({ personName }) => personName,
    );
    const projectOrder = new Map(byProject.map(({ key }, i) => [key, i]));
    const withoutKey = ({
      key: _key,
      ...total
    }: IBillingTotal & { key: string }) => total;

    return {
      clientName: client.name,
      fromDate,
      toDate,
      currency,
      approvedMinutes: sumMinutes(approved),
      billableMinutes: sumMinutes(approved.filter(({ billable }) => billable)),
      unapprovedMinutes: sumMinutes(
        entries.filter(({ status }) => NOT_YET_APPROVED.includes(status)),
      ),
      snapshotMinutes: sumMinutes(approved.filter(({ id }) => billed.has(id))),
      amount: sumOf(byProject, ({ amount }) => amount),
      unratedMinutes: sumOf(byProject, ({ unratedMinutes }) => unratedMinutes),
      lines: allLines
        .sort(
          (a, b) =>
            projectOrder.get(a.projectId)! - projectOrder.get(b.projectId)! ||
            byTime(
              { minutes: a.minutes, name: a.personName },
              { minutes: b.minutes, name: b.personName },
            ),
        )
        .map(({ projectId: _projectId, userId: _userId, ...line }) => line),
      byProject: byProject.map(withoutKey),
      byPerson: byPerson.map(withoutKey),
    };
  }
}
