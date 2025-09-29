import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import {
  EditUserModalView,
  IEditUserModalViewMetadata,
} from 'src/slack/tabs/users/views/edit-user-modal.view';
import { UsersService } from 'src/users/users.service';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/tabs/users/services/users-tab.service';
import EditUserModalViewValuesParser, {
  IEditUserFormData,
} from 'src/slack/tabs/users/parsers/edit-user-modal-view-values.parser';
import { IUsersTabMetaData } from 'src/slack/tabs/users/views/users-tab.view';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from 'src/common/enums/user-role.enum';

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
  private readonly logger = new Logger(EditUserFormSubmitHandler.name);

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
    return this.usersService.update(
      { id: meta.userIdToEdit, slackTeamId: user.slack_team_id },
      {
        role: data.role.value,
        teamId: data.team_id.value,
        contractStartDate: data.contract_start_date,
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
          'An error occurred while updating the user. Please try again later.',
        userId: metadata.userIdToEdit,
        pageMetadata: metadata.pageMetadata,
      }),
    );
  }
}
