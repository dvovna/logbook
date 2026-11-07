import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  IImportResult,
  UserVacationsImportService,
} from '@modules/user-data-import/services/user-vacations-import.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { UserTeamMappingImportService } from '@modules/user-data-import/services/user-team-mapping-import.service';

// Far more than the CSVs need (1000 rows each), small enough to hold in memory.
const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

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
    private readonly userTeamMappingImportService: UserTeamMappingImportService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {
    this.importers = {
      'user-vacations.csv': (content, user) =>
        this.userVacationsImportService.handle(content, user),
      'user-team-mapping.csv': (content, user) =>
        this.userTeamMappingImportService.handle(content, user),
    };
  }

  // The file is downloaded only when it is one of the imports and not too
  // large.
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
      return this.reply(user, this.getUnknownFileUploadPromptMessage());
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

    await this.reply(user, this.getImportSuccessfulMessage(result));
  }

  private reply(user: IUserViewModel, message: { text: string }) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      message,
      user.slack_team_id,
    );
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
