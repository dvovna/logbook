import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import capitalize from '@common/utils/capitalize';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';

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
