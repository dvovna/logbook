import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  IImportResult,
  UserVacationsImportService,
} from '@modules/user-data-import/services/user-vacations-import.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { UserTeamMappingImportService } from '@modules/user-data-import/services/user-team-mapping-import.service';

@Injectable()
export default class FileUploadService {
  public constructor(
    private readonly userVacationsImportService: UserVacationsImportService,
    private readonly userTeamMappingImportService: UserTeamMappingImportService,
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
          this.getImportSuccessfulMessage(result),
          user.slack_team_id,
        );

        break;
      }
      case 'user-team-mapping.csv': {
        const result = await this.userTeamMappingImportService.handle(
          fileContent,
          user,
        );

        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          this.getImportSuccessfulMessage(result),
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

  private getImportSuccessfulMessage(result: IImportResult) {
    if (result.errors.length) {
      return {
        text: `Import was not successful: \n ${result.errors.join('\n')}`,
      };
    }

    return {
      text: `Import was successful.\n Results: \nCreated: ${result.created}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}.`,
    };
  }

  public getUnknownFileUploadPromptMessage() {
    return {
      text: `❗️ Unknown file type.`,
    };
  }
}
