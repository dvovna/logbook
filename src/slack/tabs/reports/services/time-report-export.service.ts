import { Injectable } from '@nestjs/common';
import { formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { TimeScopeKind } from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';

const SCOPE_NAMES: Record<TimeScopeKind, string> = {
  workspace: "everyone's time",
  teams: "your teams' time and yours",
  own: 'your time',
};

// Sends a period's time entries as a CSV file in a DM with the person who
// asked (DmFileService).
@Injectable()
export class TimeReportExportService {
  public constructor(
    private readonly timeEntriesExportService: TimeEntriesExportService,
    private readonly dmFileService: DmFileService,
  ) {}

  public async send(
    user: IUserViewModel,
    { fromDate, toDate }: { fromDate: string; toDate: string },
  ) {
    const csv = await this.timeEntriesExportService.getCsv({
      user,
      fromDate,
      toDate,
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
      intro: `📄 Time report, ${period} (${SCOPE_NAMES[csv.scope]}): ${csv.entryCount} ${csv.entryCount === 1 ? 'entry' : 'entries'}, ${getDisplayTime(csv.minutes)}.`,
      title: `Time report, ${period}`,
      filename: csv.filename,
      content: csv.content,
    });
  }
}
