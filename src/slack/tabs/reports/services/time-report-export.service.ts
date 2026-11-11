import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import {
  ITimeReportCsvJob,
  ITimeReportCsvParams,
} from '@modules/slack/tabs/reports/types/time-report-csv-job.interface';
import { TimeScopeKind } from 'src/time-entries/types/time-scope.types';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';
import { TimeReportService } from 'src/time-entries/services/time-report.service';
import {
  IAppliedFilters,
  ITimeReport,
  ITimeReportFilters,
} from 'src/time-entries/types/time-report.types';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';

export const TIME_REPORT_CSV_JOB = 'time-report-csv';

const SCOPE_NAMES: Record<TimeScopeKind, string> = {
  workspace: "everyone's time",
  teams: "your teams' time and yours",
  own: 'your time',
};

// "client Acme", "person Mia Member": what the export was narrowed to,
// escaped (the message is mrkdwn).
const filterNames = ({ client, project, person }: IAppliedFilters) =>
  [
    client && `client ${escapeMrkdwn(client)}`,
    project && `project ${escapeMrkdwn(project)}`,
    person && `person ${escapeMrkdwn(person)}`,
  ].filter((name): name is string => !!name);

// One export at a time per person, period and filters; the grouping is left
// out, since the file doesn't depend on it.
const singletonKeyOf = ({
  userId,
  fromDate,
  toDate,
  filters,
}: ITimeReportCsvJob) =>
  [
    userId,
    fromDate,
    toDate,
    filters.clientId ?? '',
    filters.projectId ?? '',
    filters.userId ?? '',
  ].join(':');

// Sends the entries of the time report on show as a CSV file in a DM with
// the person who asked (DmFileService). A job: a restart or a failure of
// Slack is retried, and a file that never went is told of.
@Injectable()
export class TimeReportExportService implements OnModuleInit {
  public constructor(
    private readonly timeEntriesExportService: TimeEntriesExportService,
    private readonly timeReportService: TimeReportService,
    private readonly usersService: UsersService,
    private readonly dmFileService: DmFileService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<ITimeReportCsvJob>(
      TIME_REPORT_CSV_JOB,
      (job) => this.sendAgain(job),
      { onGiveUp: (job) => this.tellNotSent(job) },
    );
  }

  // Saves the job that sends the CSV before the click gets its answer.
  // `report` makes the report on show (`params`), once, for its first run
  // and for Reports shown again; a retry makes it again from the data of
  // then. Resolves false, saving nothing, while the same export by `user`
  // is still on its way.
  public start(
    user: IUserViewModel,
    params: ITimeReportCsvParams,
    report: () => Promise<ITimeReport>,
  ): Promise<boolean> {
    const job: ITimeReportCsvJob = {
      ...params,
      slackTeamId: user.slack_team_id,
      userId: user.id,
    };

    return this.jobs.enqueueSingleton<ITimeReportCsvJob>(
      TIME_REPORT_CSV_JOB,
      singletonKeyOf(job),
      job,
      {
        firstRun: async () => this.send(user, await report(), params.filters),
      },
    );
  }

  // `report` is the one on show, made with `filters`.
  private async send(
    user: IUserViewModel,
    report: ITimeReport,
    filters: ITimeReportFilters,
  ) {
    const csv = await this.timeEntriesExportService.getCsv({
      user,
      report,
      filters,
    });
    const period = formatDateRange(report.fromDate, report.toDate);

    if (csv.status === 'empty') {
      await this.dmFileService.say(
        user,
        `📄 No time was logged in ${period}: there is nothing to export.`,
      );

      return;
    }

    if (csv.status === 'too_many') {
      await this.dmFileService.say(
        user,
        `📄 Time report, ${period}: more than ${csv.maxEntries.toLocaleString('en-US')} entries, too many for one file. Show a shorter period or narrow the report, then send the CSV again.`,
      );

      return;
    }

    await this.dmFileService.send(user, {
      intro: `📄 Time report, ${period} (${[SCOPE_NAMES[report.scope], ...filterNames(report.filters)].join(', ')}): ${csv.entryCount} ${csv.entryCount === 1 ? 'entry' : 'entries'}, ${getDisplayTime(csv.minutes)}.`,
      title: `Time report, ${period}`,
      filename: csv.filename,
      content: csv.content,
    });
  }

  // The person as they are now: one deactivated meanwhile gets nothing.
  private async sendAgain({
    slackTeamId,
    userId,
    groupBy,
    fromDate,
    toDate,
    filters,
  }: ITimeReportCsvJob) {
    const user = await this.usersService.findOne({ id: userId, slackTeamId });

    if (!user) {
      return;
    }

    const report = await this.timeReportService.getReport({
      user,
      groupBy,
      fromDate,
      toDate,
      filters,
    });

    await this.send(user, report, filters);
  }

  private async tellNotSent({
    slackTeamId,
    userId,
    fromDate,
    toDate,
  }: ITimeReportCsvJob) {
    const user = await this.usersService.findOne({ id: userId, slackTeamId });

    if (user) {
      await this.dmFileService.say(
        user,
        `⚠️ I couldn't send the CSV of the time report, ${formatDateRange(fromDate, toDate)}: sending it kept failing for hours. Show the report on Reports and send the CSV again.`,
      );
    }
  }
}
