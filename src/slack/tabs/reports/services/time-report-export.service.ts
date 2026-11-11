import { Injectable } from '@nestjs/common';
import { formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { TimeScopeKind } from 'src/time-entries/types/time-scope.types';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';
import {
  IAppliedFilters,
  ITimeReport,
  ITimeReportFilters,
} from 'src/time-entries/types/time-report.types';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';

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

// Sends the entries of the time report on show as a CSV file in a DM with
// the person who asked (DmFileService).
@Injectable()
export class TimeReportExportService {
  public constructor(
    private readonly timeEntriesExportService: TimeEntriesExportService,
    private readonly dmFileService: DmFileService,
  ) {}

  // `report` is the one on show, made with `filters`.
  public async send(
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
}
