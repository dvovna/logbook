import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import capitalize from '@common/utils/capitalize';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';

const roleLabel = (role: UserRole) =>
  role === UserRole.HR ? 'HR' : capitalize(role);

@Injectable()
export default class SlackUserAccessService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  // True when the user has one of the roles; else tells them so, in an
  // ephemeral message.
  public async checkUserRoleAccess(
    user: IUserViewModel,
    userRoles: readonly UserRole[],
  ) {
    if (userRoles.includes(user.role)) {
      return true;
    }

    await this.slackCommunicationService.postEphemeral(
      user.slack_id,
      {
        text: `⛔ Only ${userRoles.map(roleLabel).join(' or ')} can use this command.`,
      },
      user.slack_team_id,
    );

    return false;
  }
}
