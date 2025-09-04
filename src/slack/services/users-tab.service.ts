import { Injectable } from '@nestjs/common';
import TeamsService from 'src/teams/teams.service';
import { UsersService } from 'src/users/users.service';
import {
  IUsersTabMetaData,
  UsersTabViewService,
} from 'src/slack/services/slack-views/tab-views/users-tab-view.service';
import UserRole from 'src/common/enums/user-role.enum';
import BaseTabViewService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/services/base-tab-view.service';
import { View } from '@slack/types/dist/views';
import { EditUserModalViewService } from 'src/slack/services/slack-views/modal-views/edit-user-modal-view.service';
import ConfirmationModalViewService from 'src/slack/services/slack-views/modal-views/confirmation-modal-view.service';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

interface IGetUsersTabViewParams extends IPublishBaseParams {
  page?: number;
  metadata?: IUsersTabMetaData;
}

export interface IUsersTabViewFilters {
  selectedTeamId?: string;
  selectedRole?: UserRole;
  userStatus?: 'active_only' | 'inactive_only';
}

interface IUserModalViewParams extends IOpenModalBaseParams<string> {
  userId: string;
}

export enum UsersTabModalName {
  EditUser = 'EditUser',
  ChangeUserStatus = 'ChangeUserStatus',
}

type UsersTabModalViewResolversMapType = {
  [key in UsersTabModalName]: (params: IUserModalViewParams) => Promise<View>;
};

@Injectable()
export class UsersTabService extends BaseTabViewService<
  UsersTabModalViewResolversMapType,
  IGetUsersTabViewParams
> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly usersViewService: UsersTabViewService,
    private readonly editUserModalViewService: EditUserModalViewService,
    private readonly confirmationModalViewService: ConfirmationModalViewService,
  ) {
    super({
      [UsersTabModalName.EditUser]: async (params) =>
        await this.editUserModalView(params),
      [UsersTabModalName.ChangeUserStatus]: async (params) =>
        await this.changeUserStatusModalView(params),
    });
  }

  protected async getTabView({
    user,
    page = 1,
    metadata = {},
  }: IGetUsersTabViewParams) {
    const [users, teams] = await Promise.all([
      this.usersService.search({
        filters: {
          slackTeamId: user.slack_team_id,
          ...(metadata?.filters?.selectedTeamId
            ? { teamId: metadata?.filters.selectedTeamId }
            : {}),
          ...(metadata?.filters?.selectedRole
            ? { role: metadata?.filters.selectedRole }
            : {}),
          ...(metadata?.filters?.userStatus === 'inactive_only'
            ? { isActive: false }
            : {}),
        },
        sortBy: 'name',
        sortOrder: 'asc',
        page,
      }),
      this.teamsService.findMany({ slackTeamId: user.slack_team_id }),
    ]);

    return this.usersViewService.getView(
      {
        userId: user.slack_id,
        teams,
        users,
      },
      metadata,
    );
  }

  public async editUserModalView({
    userId,
    user,
    ...modalParams
  }: IUserModalViewParams) {
    const userToEdit =
      userId === user.id
        ? user
        : await this.usersService.findOne({
          id: userId,
          slackTeamId: user.slack_team_id,
        });

    if (!userToEdit) {
      throw new Error(`User with id ${userId} not found`);
    }

    const teams = await this.teamsService.findMany({
      slackTeamId: user.slack_team_id,
    });

    return this.editUserModalViewService.getView({
      user: userToEdit,
      teams,
      ...modalParams,
    });
  }

  public async changeUserStatusModalView({
    userId,
    user,
    errorMessage,
    pageMetadata,
  }: IUserModalViewParams) {
    const userToEdit = await this.usersService.findOne({
      id: userId,
      slackTeamId: user.slack_team_id,
      includeInactive: true,
    });

    if (!userToEdit) {
      throw new Error(`User with id ${userId} not found`);
    }

    return this.confirmationModalViewService.getView({
      entityId: userToEdit.id,
      errorMessage,
      pageMetadata,
      title: `${userToEdit.is_active ? 'Deactivate' : 'Activate'} User`,
      message: `Are you sure you want to ${userToEdit.is_active ? 'deactivate' : 'activate'} the user *${userToEdit.name}*?`,
      callbackId: ViewCallbackId.ChangeUserStatus,
    });
  }
}
