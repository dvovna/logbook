import { KnownBlock } from '@slack/types';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  IImportResult,
  UserVacationsImportService,
} from '@modules/user-data-import/services/user-vacations-import.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import { LeaveFileMessagesService } from '@modules/slack/leave-file/services/leave-file-messages.service';
import { readSpreadsheet } from '@common/files/spreadsheet.reader';
import { parseTeamFile } from 'src/team-file/parsers/team-file.parser';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';
import { parseLeaveFile } from 'src/leave-file/parsers/leave-file.parser';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';

// Far more than the CSVs need (1000 rows each), small enough to hold in memory.
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

const VACATIONS_FILE = 'user-vacations.csv';

// Any other CSV or Excel file may be a team or a leave file; its columns
// tell.
const SPREADSHEET_NAME = /\.(csv|xlsx)$/i;

const UNKNOWN_FILE =
  "❗️ I can't tell what this file is. A team file needs Email and Team columns; leave balances need Email and Days left, Working days left, Bonus days left or Contract start; a leave history needs Email, Leave type, From and To.";

// HR sends these files in their conversation with Logbook; a file shared in
// a channel is for the people there.
const isDirectMessage = (channelId: string) => channelId.startsWith('D');

// The problems a result lists; the rest are counted.
const MAX_LISTED_PROBLEMS = 10;

type Importer = (
  fileContent: string,
  user: IUserViewModel,
) => Promise<IImportResult>;

@Injectable()
export default class FileUploadService {
  // The CSV imports, by the name of the shared file.
  private readonly importers: Record<string, Importer>;

  public constructor(
    private readonly userVacationsImportService: UserVacationsImportService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly teamFileUploadsService: TeamFileUploadsService,
    private readonly teamFileMessagesService: TeamFileMessagesService,
    private readonly leaveFileUploadsService: LeaveFileUploadsService,
    private readonly leaveFileMessagesService: LeaveFileMessagesService,
  ) {
    this.importers = {
      [VACATIONS_FILE]: (content, user) =>
        this.userVacationsImportService.handle(content, user),
    };
  }

  // The file is downloaded only when it is one of the imports or may be a
  // team or a leave file, and not too large.
  public async handleFileUpload(
    fileId: string,
    channelId: string,
    user: IUserViewModel,
  ) {
    const file = await this.slackCommunicationService.getFileInfo(
      fileId,
      user.slack_team_id,
    );

    const url = file?.url_private_download;
    if (!url) {
      return;
    }

    const importFile = file.name ? this.importers[file.name] : undefined;

    if (!importFile) {
      if (!file.name || !SPREADSHEET_NAME.test(file.name)) {
        return this.reply(user, this.getUnknownFileUploadPromptMessage());
      }

      return isDirectMessage(channelId)
        ? this.handleSpreadsheet(file.name, file.size ?? 0, url, user)
        : undefined;
    }

    if (file.name === VACATIONS_FILE && user.role !== UserRole.Admin) {
      return this.reply(user, {
        text: '⛔ Only admins can import vacations.',
      });
    }

    if ((file.size ?? 0) > MAX_IMPORT_FILE_BYTES) {
      return this.reply(user, {
        text: '❗️ The file is larger than 1 MB, so it was not imported.',
      });
    }

    const fileContent = await this.slackCommunicationService.fetchFileContent(
      url,
      user.slack_team_id,
      MAX_IMPORT_FILE_BYTES,
    );

    const result = await importFile(fileContent, user);

    await this.reply(user, this.getImportResultMessage(file.name!, result));
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

      teamRows = parseTeamFile(lines);
      leaveFile = teamRows ? null : parseLeaveFile(lines);
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

  // E.g. "✅ Imported `user-vacations.csv`: Created 12 · Updated 3 ·
  // Skipped 0", and the first problems when there were any.
  private getImportResultMessage(fileName: string, result: IImportResult) {
    const { created, updated, skipped, errors } = result;
    const counts = `Created ${created} · Updated ${updated} · Skipped ${skipped}`;
    const nothingImported = created + updated === 0;
    const summary = !errors.length
      ? `✅ Imported \`${fileName}\`: ${counts}`
      : nothingImported
        ? `❗️ \`${fileName}\` was not imported: ${counts}`
        : `⚠️ Imported \`${fileName}\` with problems: ${counts}`;
    const blocks: KnownBlock[] = [
      { type: 'section', text: { type: 'mrkdwn', text: summary } },
    ];

    if (errors.length) {
      const listed = errors
        .slice(0, MAX_LISTED_PROBLEMS)
        .map((error) => `• ${escapeMrkdwn(error)}`);
      const more = errors.length - listed.length;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*${errors.length === 1 ? '1 problem' : `${errors.length} problems`}:*`,
            ...listed,
            ...(more > 0 ? [`…and ${more} more`] : []),
          ].join('\n'),
        },
      });
    }

    return { text: summary, blocks };
  }

  public getUnknownFileUploadPromptMessage() {
    return {
      text: `❗️ Unknown file type.`,
    };
  }
}
