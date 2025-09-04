import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { UsersService } from 'src/users/users.service';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/services/users-tab.service';
import { IUsersTabMetaData } from 'src/slack/services/slack-views/tab-views/users-tab-view.service';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ConfirmationModalViewService, {
  IConfirmationModalViewMetadata,
} from 'src/slack/services/slack-views/modal-views/confirmation-modal-view.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ChangeUserStatus,
  type: 'view_submission',
})
export class ChangeUserStatusFormSubmitHandler {
  private logger: Logger = new Logger(ChangeUserStatusFormSubmitHandler.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly usersTabService: UsersTabService,
    private readonly confirmationModalViewService: ConfirmationModalViewService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IConfirmationModalViewMetadata>(payload);
    const { entityId: userId } = metadata;
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
              pageMetadata: metadata.pageMetadata,
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
        this.confirmationModalViewService.getSuccessView(
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
            pageMetadata: metadata.pageMetadata,
          },
        ),
      );
    }
  }
}
