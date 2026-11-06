import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  IImportResult,
  UserVacationsImportService,
} from 'src/user-data-import/user-vacations-import.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import {
  IUserTeamsImportResult,
  UserTeamsImportService,
} from 'src/user-data-import/user-teams-import.service';

const MAX_REPORTED_PROBLEMS = 20;

@Injectable()
export default class FileUploadService {
  public constructor(
    private readonly userVacationsImportService: UserVacationsImportService,
    private readonly userTeamsImportService: UserTeamsImportService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public async handleFileUpload(fileId: string, user: IUserViewModel) {
    const file = await this.slackCommunicationService.getFileInfo(
      fileId,
      user.slack_team_id,
    );

    const url = file?.url_private_download;
    if (!url) {
      return;
    }

    const fileContent = await this.slackCommunicationService.fetchFileContent(
      url,
      user.slack_team_id,
    );

    switch (file?.name) {
      case 'user-vacations.csv': {
        const result = await this.userVacationsImportService.handle(
          fileContent,
          user,
        );

        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          this.getUserVacationsImportSuccessfulMessage(result),
          user.slack_team_id,
        );

        break;
      }
      case 'user-teams.csv': {
        const result = await this.userTeamsImportService.handle(
          fileContent,
          user,
        );

        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          this.getUserTeamsImportMessage(result),
          user.slack_team_id,
        );

        break;
      }
      default: {
        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          this.getUnknownFileUploadPromptMessage(),
          user.slack_team_id,
        );
      }
    }
  }

  public getUserVacationsImportSuccessfulMessage(result: IImportResult) {
    if (result.errors.length) {
      return {
        text: `Import was not successful: \n ${result.errors.join('\n')}`,
      };
    }

    return {
      text: `Import was successful.\n Results: \nCreated: ${result.created}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}.`,
    };
  }

  public getUserTeamsImportMessage(result: IUserTeamsImportResult) {
    const { updated, unchanged, skipped, errors } = result;
    const processed = updated + unchanged + skipped;

    if (processed === 0 && errors.length) {
      return { text: `Import was not successful:\n${errors.join('\n')}` };
    }

    const lines = [
      'User teams import finished.',
      `Updated: ${updated}`,
      `Unchanged: ${unchanged}`,
      `Skipped: ${skipped}`,
    ];

    if (errors.length) {
      const shown = errors.slice(0, MAX_REPORTED_PROBLEMS);
      const hidden = errors.length - shown.length;

      lines.push(
        '',
        'Problems:',
        ...shown.map((error) => `• ${error}`),
        ...(hidden > 0 ? [`…and ${hidden} more`] : []),
      );
    }

    return { text: lines.join('\n') };
  }

  public getUnknownFileUploadPromptMessage() {
    return {
      text: `❗️ Unknown file type.`,
    };
  }
}
