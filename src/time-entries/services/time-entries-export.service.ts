import { Inject, Injectable } from '@nestjs/common';
import { csvLines, csvStart, csvText } from '@common/utils/csv.utils';
import { amountInCents } from '@common/utils/money.utils';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { canSeeRates } from 'src/projects/constants/rate-roles';
import {
  ITimeEntriesExportLimits,
  TIME_ENTRIES_EXPORT_LIMITS,
} from 'src/time-entries/constants/time-entries-export';
import {
  scopeFilterOf,
  TimeEntriesScopeService,
} from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import {
  ITimeReport,
  ITimeReportCsvRow,
  ITimeReportFilters,
  TimeReportCsvCursor,
} from 'src/time-entries/types/time-report.types';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';

export type TimeEntriesCsv =
  // No entries: no file.
  | { status: 'empty' }
  // More entries than a file may hold (maxEntries): no file.
  | { status: 'too_many'; maxEntries: number }
  | {
      status: 'ready';
      filename: string;
      content: string;
      entryCount: number;
      minutes: number;
    };

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

const cursorOf = ({
  work_date,
  person,
  project,
  created_at,
  id,
}: ITimeReportCsvRow): TimeReportCsvCursor => ({
  work_date,
  person,
  project,
  created_at,
  id,
});

// The entries of a time report as a CSV file, one line each, for a
// spreadsheet or an invoice: the same entries, scope and filters as the
// report. Admin and Finance also get each entry's rate (the person's own on
// the project, else the project's) and amount: its billable time at that
// rate, rounded to the cent. The entries are read a page at a time, in the
// file's order, and only the file's text is kept.
@Injectable()
export class TimeEntriesExportService {
  public constructor(
    private readonly scopeService: TimeEntriesScopeService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly slackTeamsService: SlackTeamsService,
    @Inject(TIME_ENTRIES_EXPORT_LIMITS)
    private readonly limits: ITimeEntriesExportLimits,
  ) {}

  // The CSV of `report`, which `user` made with `filters`. Its entry count
  // tells an empty or too big file before anything is read.
  public async getCsv({
    user,
    report,
    filters,
  }: {
    user: IUserViewModel;
    report: ITimeReport;
    filters: ITimeReportFilters;
  }): Promise<TimeEntriesCsv> {
    const { pageSize, maxEntries } = this.limits;

    assertReportPeriod(report.fromDate, report.toDate);

    if (!report.entryCount) {
      return { status: 'empty' };
    }

    if (report.entryCount > maxEntries) {
      return { status: 'too_many', maxEntries };
    }

    const withRates = canSeeRates(user.role);
    const [scope, currency] = await Promise.all([
      this.scopeService.scopeOf(user),
      withRates ? this.slackTeamsService.getCurrency(user.slack_team_id) : '',
    ]);
    const query = {
      dateFrom: report.fromDate,
      dateTo: report.toDate,
      scope: scopeFilterOf(scope, user),
      filters,
    };
    const parts = [
      csvStart(withRates ? [...COLUMNS, ...RATE_COLUMNS] : COLUMNS),
    ];
    let entryCount = 0;
    let minutes = 0;
    let after: TimeReportCsvCursor | undefined;

    for (;;) {
      const page = await this.timeEntriesService.findReportCsvPage(
        user.slack_team_id,
        query,
        { after, limit: pageSize, withRates },
      );

      entryCount += page.length;

      // Logged since the report was made.
      if (entryCount > maxEntries) {
        return { status: 'too_many', maxEntries };
      }

      for (const row of page) {
        minutes += row.minutes;
      }

      parts.push(
        csvLines(page.map((row) => this.lineOf(row, withRates, currency))),
      );

      if (page.length < pageSize) {
        break;
      }

      after = cursorOf(page[page.length - 1]);
    }

    return entryCount
      ? {
          status: 'ready',
          filename: `time-report-${report.fromDate}-to-${report.toDate}.csv`,
          content: parts.join(''),
          entryCount,
          minutes,
        }
      : { status: 'empty' };
  }

  private lineOf(
    row: ITimeReportCsvRow,
    withRates: boolean,
    currency: string,
  ): string[] {
    const line = [
      row.work_date,
      csvText(row.person),
      csvText(row.email),
      csvText(row.team),
      csvText(row.client),
      csvText(row.project),
      csvText(row.description),
      hours(row.minutes),
      row.billable ? 'yes' : 'no',
      row.status,
    ];

    if (!withRates) {
      return line;
    }

    const rate = row.hourly_rate;

    return [
      ...line,
      rate === null ? '' : rate.toFixed(2),
      rate === null || !row.billable
        ? ''
        : money(amountInCents(row.minutes, rate)),
      currency,
    ];
  }
}
