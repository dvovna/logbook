import { Injectable } from '@nestjs/common';
import { formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { slackErrorOf } from 'src/api-clients/third-party/slack-api.client';
import { TimeScopeKind } from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';

const SCOPE_NAMES: Record<TimeScopeKind, string> = {
  workspace: "everyone's time",
  teams: "your teams' time and yours",
  own: 'your time',
};

// Workspaces that installed Logbook before the export have no files:write.
export const NO_FILES_PERMISSION =
  "⚠️ I couldn't attach the file: Logbook doesn't have the permission to upload files in this workspace yet. Ask whoever installed Logbook to install it again (nothing is lost), then export again.";

// Sends a period's time entries as a CSV file in a DM with the person who
// asked: a message first, since its answer names the DM channel (opening one
// would take the im:write scope), then the file in that channel.
@Injectable()
export class TimeReportExportService {
  public constructor(
    private readonly timeEntriesExportService: TimeEntriesExportService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public async send(
    user: IUserViewModel,
    { fromDate, toDate }: { fromDate: string; toDate: string },
  ) {
    const teamId = user.slack_team_id;
    const csv = await this.timeEntriesExportService.getCsv({
      user,
      fromDate,
      toDate,
    });
    const period = formatDateRange(fromDate, toDate);

    if (!csv.entryCount) {
      await this.slackCommunicationService.postMessage(
        user.slack_id,
        {
          text: `📄 No time was logged in ${period}: there is nothing to export.`,
        },
        teamId,
      );

      return;
    }

    const intro = `📄 Time report, ${period} (${SCOPE_NAMES[csv.scope]}): ${csv.entryCount} ${csv.entryCount === 1 ? 'entry' : 'entries'}, ${getDisplayTime(csv.minutes)}.`;
    const message = await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text: intro },
      teamId,
    );

    try {
      await this.slackCommunicationService.uploadFile(
        {
          channelId: message.channel!,
          filename: csv.filename,
          title: `Time report, ${period}`,
          content: csv.content,
        },
        teamId,
      );
    } catch (error) {
      if (slackErrorOf(error) !== 'missing_scope') {
        throw error;
      }

      await this.slackCommunicationService.updateMessage(
        message.channel!,
        message.ts!,
        { text: `${intro}\n${NO_FILES_PERMISSION}` },
        teamId,
      );
    }
  }
}
