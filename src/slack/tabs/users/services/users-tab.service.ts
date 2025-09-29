import { Injectable } from '@nestjs/common';
import TeamsService from 'src/teams/services/teams.service';
import { UsersService } from 'src/users/services/users.service';
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
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import ITeamViewModel from 'src/teams/types/team.interface';
import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { UserVacationUsageModalView } from 'src/slack/tabs/users/views/user-vacation-usage-modal.view';

export interface IGetUsersTabViewParams extends IPublishBaseParams {
  metadata?: IUsersTabMetaData;
}

export interface IUsersTabViewFilters {
  teamId?: string;
  role?: UserRole;
  user?: { value: string; name: string };
  status?: 'active_only' | 'inactive_only';
}

interface IUserModalViewParams extends IOpenModalBaseParams<string> {
  userId: string;
}

export enum UsersTabModalName {
  ViewVacationUsage = 'ViewVacationUsage',
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
    private readonly editUserModalView: EditUserModalView,
    private readonly userVacationUsageModalView: UserVacationUsageModalView,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly vacationsUsageService: VacationsUsageService,
  ) {
    super(TabId.Users, {
      [UsersTabModalName.ViewVacationUsage]: async (params) =>
        await this.getViewUserVacationUsageModalView(params),
      [UsersTabModalName.EditUser]: async (params) =>
        await this.getEditUserModalView(params),
      [UsersTabModalName.ChangeUserStatus]: async (params) =>
        await this.getChangeUserStatusModalView(params),
    });
  }

  protected async getTabView(params: IGetUsersTabViewParams) {
    const userTeams = await this.getUserTeams(params.user);
    const users = await this.getUsers(params, userTeams);

    return this.usersViewService.getView(
      {
        userId: params.user.slack_id,
        userRole: params.user.role,
        teams: userTeams,
        users,
      },
      params.metadata || {},
    );
  }

  private async getViewUserVacationUsageModalView({
    userId,
    user,
    pageMetadata,
    errorMessage,
  }: IUserModalViewParams) {
    const userToView = await this.usersService.findOneWithValidation({
      id: userId,
      slackTeamId: user.slack_team_id,
    });
    const usage =
      await this.vacationsUsageService.getCurrentVacationPeriodUsage(
        userToView,
      );

    return this.userVacationUsageModalView.getView(
      {
        user: userToView,
        usage,
        errorMessage,
      },
      {
        pageMetadata,
      },
    );
  }

  private async getEditUserModalView({
    userId,
    user,
    pageMetadata,
    ...modalParams
  }: IUserModalViewParams) {
    let userToEdit = user;

    if (userId !== user.id) {
      userToEdit = await this.usersService.findOneWithValidation({
        id: userId,
        slackTeamId: user.slack_team_id,
      });
    }

    const teams = await this.teamsService.findMany({
      slackTeamId: user.slack_team_id,
    });

    return this.editUserModalView.getView(
      {
        user: userToEdit,
        teams,
        ...modalParams,
      },
      {
        userIdToEdit: userId,
        pageMetadata,
      },
    );
  }

  private async getChangeUserStatusModalView({
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

    return this.confirmationModalView.getView(
      {
        errorMessage,
        title: `${userToEdit.is_active ? 'Deactivate' : 'Activate'} User`,
        message: `Are you sure you want to ${userToEdit.is_active ? 'deactivate' : 'activate'} the user *${userToEdit.name}*?`,
        callbackId: ViewCallbackId.ChangeUserStatus,
      },
      {
        id: userToEdit.id,
        pageMetadata,
      },
    );
  }

  private getUsers(
    { user, metadata = {} }: IGetUsersTabViewParams,
    userTeams: ITeamViewModel[],
  ) {
    const userTeamIdsRange =
      user.role === UserRole.Manager ? userTeams.map((team) => team.id) : null;

    return this.usersService.search({
      filters: {
        slackTeamId: user.slack_team_id,
        ...(metadata?.filters?.teamId
          ? { teamId: metadata?.filters.teamId }
          : {}),
        ...(userTeamIdsRange && !metadata?.filters?.teamId
          ? { teamIds: userTeamIdsRange }
          : {}),
        ...(metadata?.filters?.role ? { role: metadata?.filters.role } : {}),
        ...(metadata?.filters?.user
          ? { id: metadata?.filters.user.value }
          : {}),
        ...(metadata?.filters?.status === 'inactive_only'
          ? { isActive: false }
          : {}),
      },
      orderBy: ['name:asc'],
      page: metadata.page,
    });
  }

  private getUserTeams(user: IUserViewModel) {
    return this.teamsService.findMany({
      slackTeamId: user.slack_team_id,
      ...(user.role === UserRole.Manager
        ? { managerApprovers: [user.slack_id] }
        : {}),
    });
  }
}
