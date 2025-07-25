import { Injectable } from '@nestjs/common';
import { UserVacationsImportService } from 'src/user-data-import/user-vacations-import.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import UserRole from 'src/common/enums/user-role.enum';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackPromptsService from 'src/slack-communication/services/slack-prompts.service';

interface IFileSharedEvent {
  user_id: string;
  file_id: string;
  team_id: string;
}

@Injectable()
export default class SlackEventsService {
  public constructor(
    private readonly slackUserAccessService: SlackUserAccessService,
    private readonly userVacationsImportService: UserVacationsImportService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly slackPromptsService: SlackPromptsService,
  ) {}

  public async handleFileShared(event: IFileSharedEvent, user: IUserViewModel) {
    const { file_id: fileId } = event;

    await this.slackUserAccessService.checkUserRoleAccess(user, UserRole.Admin);

    const file = await this.slackCommunicationService.getFileInfo(
      fileId,
      user.team_id,
    );

    const url = file?.url_private_download;
    if (!url) {
      return;
    }

    const fileContent = await this.slackCommunicationService.fetchFileContent(
      url,
      user.team_id,
    );

    switch (file?.name) {
      case 'user-vacations.csv': {
        const result = await this.userVacationsImportService.handle(
          fileContent,
          user,
        );

        await this.slackCommunicationService.postMessage(
          user.slack_id,
          this.slackPromptsService.getUserVacationsImportSuccessfulMessage(
            result,
          ),
          user.team_id,
        );

        break;
      }
      case 'user-teams.csv':
        // import user teams with user managers
        break;
      default: {
        await this.slackCommunicationService.postMessage(
          user.slack_id,
          this.slackPromptsService.getUnknownFileUploadPromptMessage(),
          user.team_id,
        );
      }
    }
  }
}
