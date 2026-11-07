import { assertCanChangeUser } from '@modules/users/utils/admin-role.utils';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IUserViewModel,
  IUserViewModel as IUserEntity,
} from '@modules/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { UsersService } from '@modules/users/services/users.service';
import {
  UsersTabModalName,
  UsersTabService,
} from '@modules/slack/tabs/users/services/users-tab.service';
import { IUsersTabMetaData } from '@modules/slack/tabs/users/views/users-tab.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ChangeUserStatus,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ChangeUserStatusFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IUserEntity
> {
  public constructor(
    private readonly usersService: UsersService,
    private readonly usersTabService: UsersTabService,
    private readonly confirmationModalView: ConfirmationModalView,
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
      throw new NotFoundException('User not found');
    }

    assertCanChangeUser(user, userToChange, {
      isActive: !userToChange.is_active,
    });

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
      this.confirmationModalView.getSuccessView(
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
          pageMetadata: meta.pageMetadata!,
        },
      ),
    );
  }
}
