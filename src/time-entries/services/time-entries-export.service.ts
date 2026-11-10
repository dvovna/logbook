import { Injectable } from '@nestjs/common';
import { csvText, toCsv } from '@common/utils/csv.utils';
import { amountInCents } from '@common/utils/money.utils';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { canSeeRates } from 'src/projects/constants/rate-roles';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { TimeScopeKind } from 'src/time-entries/services/time-entries-scope.service';
import {
  IAppliedFilters,
  ITimeReportFilters,
  rateOf,
  TimeReportService,
} from 'src/time-entries/services/time-report.service';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';

export interface ITimeEntriesExport {
  filename: string;
  content: string;
  scope: TimeScopeKind;
  filters: IAppliedFilters;
  entryCount: number;
  minutes: number;
}

const COLUMNS = [
  'Date',
  'Person',
  'Email',
  'Team',
  'Client',
  'Project',
  'Description',
  'Hours',
  'Billable',
  'Status',
];

// Only for those who see rates (RATE_ROLES).
const RATE_COLUMNS = ['Rate', 'Amount', 'Currency'];

// 15-minute steps: two decimals are exact.
const hours = (minutes: number) => (minutes / 60).toFixed(2);

const money = (cents: number) => (cents / 100).toFixed(2);

// The time entries of a period as a CSV file, one line each, for a
// spreadsheet or an invoice: the same entries, scope and filters as the time
// report (TimeReportService.findFilteredEntries). Admin and Finance also get each entry's rate (the
// person's own on the project, else the project's) and amount: its billable
// time at that rate, rounded to the cent.
@Injectable()
export class TimeEntriesExportService {
  public constructor(
    private readonly timeReportService: TimeReportService,
    private readonly projectRatesService: ProjectRatesService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  public async getCsv({
    user,
    fromDate,
    toDate,
    filters,
  }: {
    user: IUserViewModel;
    fromDate: string;
    toDate: string;
    filters?: ITimeReportFilters;
  }): Promise<ITimeEntriesExport> {
    assertReportPeriod(fromDate, toDate);

    const withRates = canSeeRates(user.role);
    const { scope, entries, applied } =
      await this.timeReportService.findFilteredEntries({
        user,
        fromDate,
        toDate,
        filters,
      });
    const projectIds = [...new Set(entries.map((entry) => entry.project_id))];
    const [clientOf, rates, currency] = await Promise.all([
      this.timeReportService.clientsByProject(user, projectIds),
      withRates && projectIds.length
        ? this.projectRatesService.findRates(projectIds, user)
        : new Map<string, IProjectRates>(),
      withRates ? this.slackTeamsService.getCurrency(user.slack_team_id) : '',
    ]);

    const lines = entries
      .map((entry) => ({
        entry,
        person: entry.user?.name ?? '',
        project: entry.project?.name ?? '',
      }))
      .sort(
        (a, b) =>
          a.entry.work_date.localeCompare(b.entry.work_date) ||
          a.person.localeCompare(b.person) ||
          a.project.localeCompare(b.project) ||
          a.entry.created_at.localeCompare(b.entry.created_at),
      );

    const rows = lines.map(({ entry, person, project }) => {
      const client = clientOf.has(entry.project_id)
        ? clientOf.get(entry.project_id)
        : entry.client;
      const row = [
        entry.work_date,
        csvText(person),
        csvText(entry.user?.email),
        csvText(entry.team?.name),
        csvText(client?.name),
        csvText(project),
        csvText(entry.description),
        hours(entry.minutes),
        entry.billable ? 'yes' : 'no',
        entry.status,
      ];

      if (!withRates) {
        return row;
      }

      const rate = rateOf(rates, entry.project_id, entry.user_id);

      return [
        ...row,
        rate === null ? '' : rate.toFixed(2),
        rate === null || !entry.billable
          ? ''
          : money(amountInCents(entry.minutes, rate)),
        currency,
      ];
    });

    return {
      filename: `time-report-${fromDate}-to-${toDate}.csv`,
      content: toCsv([
        withRates ? [...COLUMNS, ...RATE_COLUMNS] : COLUMNS,
        ...rows,
      ]),
      scope: scope.kind,
      filters: applied,
      entryCount: entries.length,
      minutes: entries.reduce((sum, { minutes }) => sum + minutes, 0),
    };
  }
}
