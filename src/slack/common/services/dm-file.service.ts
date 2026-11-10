import { Injectable } from '@nestjs/common';
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
  content: string;
}

// Files the app sends to the person who asked for them (CSV exports), in
// their DM with the app: a message first, since its answer names the DM
// channel (opening one would take the im:write scope), then the file in that
// channel. A workspace without files:write gets the message, which then
// says how to fix it.
@Injectable()
export class DmFileService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public async send(
    user: IUserViewModel,
    { intro, title, filename, content }: IDmFile,
  ) {
    const teamId = user.slack_team_id;
    const message = await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text: intro },
      teamId,
    );

    try {
      await this.slackCommunicationService.uploadFile(
        { channelId: message.channel!, filename, title, content },
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

  // A message without a file, e.g. that there is nothing to export.
  public async say(user: IUserViewModel, text: string) {
    await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text },
      user.slack_team_id,
    );
  }
}
