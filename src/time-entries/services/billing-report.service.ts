import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import ClientsService from '@modules/clients/services/clients.service';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

interface IReportLine {
  name: string;
  minutes: number;
  billableMinutes: number;
}

export interface IBillingReport {
  clientName: string;
  fromDate: string;
  toDate: string;
  approvedMinutes: number;
  billableMinutes: number;
  // Drafts, submitted and rejected entries: not billed until approved.
  unapprovedMinutes: number;
  byProject: IReportLine[];
  byPerson: IReportLine[];
}

const NOT_YET_APPROVED = [
  TimeEntryStatus.Draft,
  TimeEntryStatus.Submitted,
  TimeEntryStatus.Rejected,
];

const sumMinutes = (entries: ITimeEntryViewModel[]) =>
  entries.reduce((sum, { minutes }) => sum + minutes, 0);

// Approved time per line, most first.
const groupBy = (
  entries: ITimeEntryViewModel[],
  nameOf: (entry: ITimeEntryViewModel) => string,
): IReportLine[] => {
  const lines = new Map<string, IReportLine>();

  for (const entry of entries) {
    const name = nameOf(entry);
    const line = lines.get(name) ?? { name, minutes: 0, billableMinutes: 0 };
    line.minutes += entry.minutes;
    line.billableMinutes += entry.billable ? entry.minutes : 0;
    lines.set(name, line);
  }

  return [...lines.values()].sort((a, b) => b.minutes - a.minutes);
};

// The hours to bill a client for a period: approved time on the client's
// projects (archived ones included), by project and by person.
@Injectable()
export class BillingReportService {
  public constructor(
    private readonly clientsService: ClientsService,
    private readonly projectsService: ProjectsService,
    private readonly timeEntriesService: TimeEntriesService,
  ) {}

  public async getClientReport({
    slackTeamId,
    clientId,
    fromDate,
    toDate,
  }: {
    slackTeamId: string;
    clientId: string;
    fromDate: string;
    toDate: string;
  }): Promise<IBillingReport> {
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
    const projectNames = new Map(projects.map(({ id, name }) => [id, name]));
    const entries = projects.length
      ? await this.timeEntriesService.findMany({
        slackTeamId,
        projectIds: projects.map(({ id }) => id),
        dateFrom: fromDate,
        dateTo: toDate,
      })
      : [];
    const approved = entries.filter(
      ({ status }) => status === TimeEntryStatus.Approved,
    );

    return {
      clientName: client.name,
      fromDate,
      toDate,
      approvedMinutes: sumMinutes(approved),
      billableMinutes: sumMinutes(approved.filter(({ billable }) => billable)),
      unapprovedMinutes: sumMinutes(
        entries.filter(({ status }) => NOT_YET_APPROVED.includes(status)),
      ),
      byProject: groupBy(
        approved,
        (entry) => projectNames.get(entry.project_id) ?? 'Unknown project',
      ),
      byPerson: groupBy(approved, (entry) => entry.user?.name ?? 'Unknown user'),
    };
  }
}
