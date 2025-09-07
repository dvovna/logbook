import { Injectable } from '@nestjs/common';
import TeamsService from 'src/teams/teams.service';
import { UsersService } from 'src/users/users.service';
import {
  IUsersTabMetaData,
  UsersTabView,
} from 'src/slack/tabs/users/views/users-tab.view';
import UserRole from 'src/common/enums/user-role.enum';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { EditUserModalView } from 'src/slack/tabs/users/views/edit-user-modal.view';
import ConfirmationModalView from 'src/slack/common/views/confirmation-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';

export interface IGetUsersTabViewParams extends IPublishBaseParams {
  metadata?: IUsersTabMetaData;
}

export interface IUsersTabViewFilters {
  teamId?: string;
  role?: UserRole;
  status?: 'active_only' | 'inactive_only';
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
export class UsersTabService extends BaseTabService<
  UsersTabModalViewResolversMapType,
  IGetUsersTabViewParams
> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly usersViewService: UsersTabView,
    private readonly editUserModalViewService: EditUserModalView,
    private readonly confirmationModalViewService: ConfirmationModalView,
  ) {
    super(TabId.Users, {
      [UsersTabModalName.EditUser]: async (params) =>
        await this.editUserModalView(params),
      [UsersTabModalName.ChangeUserStatus]: async (params) =>
        await this.changeUserStatusModalView(params),
    });
  }

  protected async getTabView({ user, metadata = {} }: IGetUsersTabViewParams) {
    const [users, teams] = await Promise.all([
      this.usersService.search({
        filters: {
          slackTeamId: user.slack_team_id,
          ...(metadata?.filters?.teamId
            ? { teamId: metadata?.filters.teamId }
            : {}),
          ...(metadata?.filters?.role ? { role: metadata?.filters.role } : {}),
          ...(metadata?.filters?.status === 'inactive_only'
            ? { isActive: false }
            : {}),
        },
        sortBy: 'name',
        sortOrder: 'asc',
        page: metadata.page,
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
