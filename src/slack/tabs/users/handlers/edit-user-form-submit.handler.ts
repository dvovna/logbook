import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  EditUserModalView,
  IEditUserModalViewMetadata,
  NO_TEAM_VALUE,
} from '@modules/slack/tabs/users/views/edit-user-modal.view';
import { UsersService } from '@modules/users/services/users.service';
import {
  UsersTabModalName,
  UsersTabService,
} from '@modules/slack/tabs/users/services/users-tab.service';
import EditUserModalViewValuesParser, {
  IEditUserFormData,
} from '@modules/slack/tabs/users/parsers/edit-user-modal-view-values.parser';
import { IUsersTabMetaData } from '@modules/slack/tabs/users/views/users-tab.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UserFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class EditUserFormSubmitHandler extends BaseModalFormSubmitHandler<
  IEditUserModalViewMetadata,
  IEditUserFormData,
  IUserViewModel | null
> {
  public constructor(
    private readonly usersService: UsersService,
    private readonly userModalViewService: EditUserModalView,
    private readonly usersTabService: UsersTabService,
    private readonly tabNavigationService: TabNavigationService,
    userModalViewValuesParser: EditUserModalViewValuesParser,
  ) {
    super(userModalViewValuesParser);
  }

  protected async onSubmit(
    data: IEditUserFormData,
    meta: IEditUserModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IUserViewModel | null> {
    return await this.usersService.update(
      { id: meta.userIdToEdit, slackTeamId: user.slack_team_id },
      {
        role: data.role.value,
        teamId:
          data.team_id.value === NO_TEAM_VALUE ? null : data.team_id.value,
        contractStartDate: data.contract_start_date
          ? new Date(data.contract_start_date)
          : null,
        carryoverDays: data.carryover_days,
        updatedBy: user.id,
      },
    );
  }

  protected successResponse(
    updatedUser: IUserViewModel | null,
    user: IUserViewModel,
    metadata: IEditUserModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IUsersTabMetaData)
      : {};

    this.tabNavigationService.navigate(TabId.Users, {
      user,
      page: 1,
      metadata: pageMetadata,
    });

    if (!updatedUser) {
      this.logger.error('Failed to update user');
      throw new Error('Failed to update user');
    }

    return SlackViewResponseFactory.update(
      this.userModalViewService.getSuccessView(
        `✅ User '${updatedUser.name}' was updated successfully!`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IEditUserFormData,
    metadata: IEditUserModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.error(`Error updating user`, errorMessage);

    return SlackViewResponseFactory.update(
      await this.usersTabService.getModalView(UsersTabModalName.EditUser, {
        user,
        errorMessage:
          errorMessage ||
          'An error occurred while updating the user. Please try again later.',
        userId: metadata.userIdToEdit,
        pageMetadata: metadata.pageMetadata,
      }),
    );
  }
}
