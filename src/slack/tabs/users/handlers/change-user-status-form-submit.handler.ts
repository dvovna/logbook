import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { UsersService } from 'src/users/users.service';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/tabs/users/services/users-tab.service';
import { IUsersTabMetaData } from 'src/slack/tabs/users/views/users-tab.view';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/confirmation-modal.view';
import { IUserViewModel as IUserEntity } from 'src/users/types/user.interface';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ChangeUserStatus,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class ChangeUserStatusFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IUserEntity
> {
  private readonly logger = new Logger(ChangeUserStatusFormSubmitHandler.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly usersTabService: UsersTabService,
    private readonly confirmationModalViewService: ConfirmationModalView,
  ) {
    super();
  }

  protected async onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IUserEntity> {
    const { id: userId } = meta;

    const userToChange = await this.usersService.findOne({
      id: userId,
      slackTeamId: user.slack_team_id,
      includeInactive: true,
    });

    if (!userToChange) {
      throw new Error('User not found');
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

    if (!updatedUser) {
      this.logger.error('Failed to update user status');
      throw new Error('Failed to update user status');
    }

    return updatedUser;
  }

  protected successResponse(
    updatedUser: IUserEntity,
    user: IUserViewModel,
    metadata: IConfirmationModalViewMetadata,
  ): ViewResponseAction {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IUsersTabMetaData)
      : {};

    this.usersTabService.publish({
      user,
      metadata: {
        ...pageMetadata,
        page: 1,
      },
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalViewService.getSuccessView(
        `✅ User '${updatedUser.name}' has been successfully ${
          updatedUser.is_active ? 'activated' : 'deactivated'
        }.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error changing user status: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      await this.usersTabService.getModalView(
        UsersTabModalName.ChangeUserStatus,
        {
          user,
          userId: meta.id,
          errorMessage,
          pageMetadata: meta.pageMetadata,
        },
      ),
    );
  }
}
