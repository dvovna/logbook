import { KnownBlock } from '@slack/types';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import { LeaveFileMessagesService } from '@modules/slack/leave-file/services/leave-file-messages.service';
import { readSpreadsheet } from '@common/files/spreadsheet.reader';
import { parseTeamFile } from 'src/team-file/parsers/team-file.parser';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { parseLeaveFile } from 'src/leave-file/parsers/leave-file.parser';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';

// Far more than a file of 5000 rows needs, small enough to hold in memory.
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

// A CSV or Excel file may be a team or a leave file; its columns tell.
const SPREADSHEET_NAME = /\.(csv|xlsx)$/i;

const UNKNOWN_FILE =
  "❗️ I can't tell what this file is. A team file needs Email and Team columns; leave balances need Email and Days left, Working days left, Bonus days left or Contract start; a leave history needs Email, Leave type, From and To.";

// HR sends these files in their conversation with Logbook; a file shared in
// a channel is for the people there.
const isDirectMessage = (channelId: string) => channelId.startsWith('D');

@Injectable()
export default class FileUploadService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly teamFileUploadsService: TeamFileUploadsService,
    private readonly teamFileMessagesService: TeamFileMessagesService,
    private readonly leaveFileUploadsService: LeaveFileUploadsService,
    private readonly leaveFileMessagesService: LeaveFileMessagesService,
  ) {}

  // Files are the app's business only in the sharer's conversation with it;
  // a file in a channel is for the people there, and nobody is answered.
  // The file is downloaded only when it may be a team or a leave file, and
  // not too large.
  public async handleFileUpload(
    fileId: string,
    channelId: string,
    user: IUserViewModel,
  ) {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return isDirectMessage(channelId)
        ? this.reply(user, {
            text: '⛔ Only Admin or HR can import files into Logbook.',
          })
        : undefined;
    }

    if (!isDirectMessage(channelId)) {
      return;
    }

    const file = await this.slackCommunicationService.getFileInfo(
      fileId,
      user.slack_team_id,
    );

    const url = file?.url_private_download;
    if (!url) {
      return;
    }

    if (!file.name || !SPREADSHEET_NAME.test(file.name)) {
      return this.reply(user, this.getUnknownFileUploadPromptMessage());
    }

    return this.handleSpreadsheet(file.name, file.size ?? 0, url, user);
  }

  // A team file is told by its Email and Team columns, a leave file by its
  // own. A refusal of a parser is final and told to the sharer; running the
  // job again would only repeat it.
  private async handleSpreadsheet(
    fileName: string,
    size: number,
    url: string,
    user: IUserViewModel,
  ) {
    if (size > MAX_IMPORT_FILE_BYTES) {
      return this.reply(user, {
        text: '❗️ The file is larger than 1 MB, so it was not imported.',
      });
    }

    const bytes = await this.slackCommunicationService.fetchFileBytes(
      url,
      user.slack_team_id,
      MAX_IMPORT_FILE_BYTES,
    );
    let teamRows;
    let leaveFile;

    try {
      const lines = await readSpreadsheet(bytes, fileName);

      // A leave history may name the team beside each leave: its Leave
      // type, From and To columns tell it from a team file.
      leaveFile = parseLeaveFile(lines);
      teamRows =
        leaveFile?.kind === LeaveFileKind.History ? null : parseTeamFile(lines);
      leaveFile = teamRows ? null : leaveFile;
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      return this.reply(user, { text: `❗️ ${escapeMrkdwn(error.message)}` });
    }

    if (teamRows) {
      const { upload, plan, state } = await this.teamFileUploadsService.receive(
        teamRows,
        fileName,
        user,
      );

      return this.teamFileMessagesService.postPreview(
        user,
        upload,
        plan,
        state,
      );
    }

    if (leaveFile) {
      const { upload, preview } = await this.leaveFileUploadsService.receive(
        leaveFile,
        fileName,
        user,
      );

      return this.leaveFileMessagesService.postPreview(user, upload, preview);
    }

    return this.reply(user, { text: UNKNOWN_FILE });
  }

  private reply(
    user: IUserViewModel,
    message: { text: string; blocks?: KnownBlock[] },
  ) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      message,
      user.slack_team_id,
    );
  }

  public getUnknownFileUploadPromptMessage() {
    return {
      text: `❗️ Unknown file type.`,
    };
  }
}
