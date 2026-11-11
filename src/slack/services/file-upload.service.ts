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
import { parseTeamFile } from 'src/team-file/parsers/team-file.parser';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';

// Far more than the CSVs need (1000 rows each), small enough to hold in memory.
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

const VACATIONS_FILE = 'user-vacations.csv';

// Any other CSV or Excel file may be a team file; its columns tell.
const TEAM_FILE_NAME = /\.(csv|xlsx)$/i;

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
  ) {
    this.importers = {
      [VACATIONS_FILE]: (content, user) =>
        this.userVacationsImportService.handle(content, user),
    };
  }

  // The file is downloaded only when it is one of the imports or may be a
  // team file, and not too large.
  public async handleFileUpload(fileId: string, user: IUserViewModel) {
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
      return file.name && TEAM_FILE_NAME.test(file.name)
        ? this.handleTeamFile(file.name, file.size ?? 0, url, user)
        : this.reply(user, this.getUnknownFileUploadPromptMessage());
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

  // A refusal of the parser is final and told to the sharer; running the job
  // again would only repeat it.
  private async handleTeamFile(
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
    let rows;

    try {
      rows = await parseTeamFile(bytes, fileName);
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      return this.reply(user, { text: `❗️ ${escapeMrkdwn(error.message)}` });
    }

    if (!rows) {
      return this.reply(user, this.getUnknownFileUploadPromptMessage());
    }

    const { upload, plan, state } = await this.teamFileUploadsService.receive(
      rows,
      fileName,
      user,
    );

    await this.teamFileMessagesService.postPreview(user, upload, plan, state);
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
