import { Injectable } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import capitalize from 'src/common/utils/capitalize';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

@Injectable()
export default class SlackUserAccessService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  public async checkUserRoleAccess(user: IUserViewModel, userRole: UserRole) {
    if (user.role !== userRole) {
      await this.slackCommunicationService.postEphemeral(
        user.slack_id,
        {
          text: `⛔ Only user with role ${capitalize(userRole)} can use this command.`,
        },
        user.slack_team_id,
      );

      throw new Error(
        `User with role ${user.role} tried to access command that requires ${userRole} role.`,
      );
    }
  }
}
