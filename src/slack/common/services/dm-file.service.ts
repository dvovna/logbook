import { Injectable, Logger } from '@nestjs/common';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { slackErrorOf } from 'src/api-clients/third-party/slack-api.client';

// Workspaces that installed Logbook before the export have no files:write.
export const NO_FILES_PERMISSION =
  "⚠️ I couldn't attach the file: Logbook doesn't have the permission to upload files in this workspace yet. Ask whoever installed Logbook to install it again (nothing is lost), then export again.";

interface IDmFile {
  // The message the file comes with, e.g. what the file holds.
  intro: string;
  title: string;
  filename: string;
  content: string | Buffer;
}

const withoutFile = (intro: string) => `${intro}\n${NO_FILES_PERMISSION}`;

// Files the app sends to the person who asked for them (CSV exports), in
// their DM with the app: a message, then the file under it. The file is
// uploaded first, the slow part that fails; then the message goes, since its
// answer names the DM channel (opening one would take the im:write scope),
// and the file is shared there. When sharing fails the message is deleted,
// so that a retry leaves no message without its file. A workspace without
// files:write gets the message, which then says how to fix it.
@Injectable()
export class DmFileService {
  private readonly logger = new Logger(DmFileService.name);

  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public async send(
    user: IUserViewModel,
    { intro, title, filename, content }: IDmFile,
  ) {
    const teamId = user.slack_team_id;
    let fileId: string;

    try {
      fileId = await this.slackCommunicationService.uploadFile(
        { filename, content },
        teamId,
      );
    } catch (error) {
      if (slackErrorOf(error) !== 'missing_scope') {
        throw error;
      }

      await this.say(user, withoutFile(intro));

      return;
    }

    const message = await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text: intro },
      teamId,
    );
    const channel = message.channel!;
    const ts = message.ts!;

    try {
      await this.slackCommunicationService.shareFile(
        { fileId, channelId: channel, title },
        teamId,
      );
    } catch (error) {
      if (slackErrorOf(error) === 'missing_scope') {
        await this.slackCommunicationService.updateMessage(
          channel,
          ts,
          { text: withoutFile(intro) },
          teamId,
        );

        return;
      }

      await this.slackCommunicationService
        .deleteMessage(channel, ts, teamId)
        .catch((deleteError: Error) =>
          this.logger.warn(
            `Failed to delete the message of a file that wasn't shared: ${deleteError.message}`,
          ),
        );

      throw error;
    }
  }

  // A message without a file, e.g. that there is nothing to export.
  public async say(user: IUserViewModel, text: string) {
    await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text },
      user.slack_team_id,
    );
  }
}
