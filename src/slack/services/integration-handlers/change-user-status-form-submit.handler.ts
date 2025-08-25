import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { UsersService } from 'src/users/users.service';
import ChangeUserStatusModalViewService, {
  IChangeUserStatusModalViewMetadata,
} from 'src/slack/services/slack-views/modal-views/change-user_status-modal-view.service';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/services/users-tab.service';
import { IUsersTabMetaData } from 'src/slack/services/slack-views/tab-views/users-tab-view.service';

@Injectable()
export class ChangeUserStatusFormSubmitHandler {
  private logger: Logger = new Logger(ChangeUserStatusFormSubmitHandler.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly usersTabService: UsersTabService,
    private readonly changeUserStatusModalService: ChangeUserStatusModalViewService,
  ) {}

  public async handle(
    _payload: ISlackInteractionPayload,
    metadata: IChangeUserStatusModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const { userId } = metadata;
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IUsersTabMetaData)
      : {};

    try {
      const userToChange = await this.usersService.findOne({
        id: userId,
        slackTeamId: user.slack_team_id,
        includeInactive: true,
      });

      if (!userToChange) {
        return SlackViewResponseFactory.update(
          await this.usersTabService.getModalView(
            UsersTabModalName.ChangeUserStatus,
            {
              user,
              errorMessage: 'User not found',
              userId,
            },
          ),
        );
      }

      const updatedUser = await this.usersService.update(
        {
          id: userId,
          slackTeamId: user.slack_team_id,
          includeInactive: true,
        },
        {
          isActive: !userToChange.is_active,
          updatedBy: user.id,
        },
      );

      this.usersTabService.publish({ user, metadata: pageMetadata, page: 1 });

      return SlackViewResponseFactory.update(
        this.changeUserStatusModalService.getSuccessView(
          `✅ User '${updatedUser!.name}' has been successfully ${updatedUser!.is_active ? 'activated' : 'deactivated'}.`,
        ),
      );
    } catch (error) {
      const errorMessage =
        'An error occurred while changing user status. Please try again later.';

      this.logger.warn(`Error changing user status: ${error.message}`, error);

      return SlackViewResponseFactory.update(
        await this.usersTabService.getModalView(
          UsersTabModalName.ChangeUserStatus,
          {
            userId,
            user,
            errorMessage,
          },
        ),
      );
    }
  }
}
