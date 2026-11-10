import { Injectable } from '@nestjs/common';
import { formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { TimeScopeKind } from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';
import {
  IAppliedFilters,
  ITimeReportFilters,
} from 'src/time-entries/services/time-report.service';
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

// Sends a period's time entries, as the time report on show narrowed them,
// as a CSV file in a DM with the person who asked (DmFileService).
@Injectable()
export class TimeReportExportService {
  public constructor(
    private readonly timeEntriesExportService: TimeEntriesExportService,
    private readonly dmFileService: DmFileService,
  ) {}

  public async send(
    user: IUserViewModel,
    {
      fromDate,
      toDate,
      clientId,
      projectId,
      userId,
    }: { fromDate: string; toDate: string } & ITimeReportFilters,
  ) {
    const csv = await this.timeEntriesExportService.getCsv({
      user,
      fromDate,
      toDate,
      filters: { clientId, projectId, userId },
    });
    const period = formatDateRange(fromDate, toDate);

    if (!csv.entryCount) {
      await this.dmFileService.say(
        user,
        `📄 No time was logged in ${period}: there is nothing to export.`,
      );

      return;
    }

    await this.dmFileService.send(user, {
      intro: `📄 Time report, ${period} (${[SCOPE_NAMES[csv.scope], ...filterNames(csv.filters)].join(', ')}): ${csv.entryCount} ${csv.entryCount === 1 ? 'entry' : 'entries'}, ${getDisplayTime(csv.minutes)}.`,
      title: `Time report, ${period}`,
      filename: csv.filename,
      content: csv.content,
    });
  }
}
