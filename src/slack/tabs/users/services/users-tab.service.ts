import { ForbiddenException, Injectable } from '@nestjs/common';
import { isPeopleAdmin } from '@modules/users/utils/people-admin-roles';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import {
  IUsersTabMetaData,
  UsersTabView,
} from '@modules/slack/tabs/users/views/users-tab.view';
import UserRole from '@common/enums/user-role.enum';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { EditUserModalView } from '@modules/slack/tabs/users/views/edit-user-modal.view';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import { UserVacationUsageModalView } from '@modules/slack/tabs/users/views/user-vacation-usage-modal.view';
import { IOption } from '@common/types/option.interface';

export interface IGetUsersTabViewParams extends IPublishBaseParams {
  metadata?: IUsersTabMetaData;
}

export type { IUsersTabViewFilters } from '@modules/slack/tabs/users/views/users-tab.view';

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
    const users = await this.getUsers(params);

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
    await this.teamsService.assertManagesTeam(user, userToView.team_id);
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
    this.assertPeopleAdmin(user);

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
    this.assertPeopleAdmin(user);

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

  // A manager sees the people of their teams only, whatever team the filter
  // names: the filter comes from the client.
  private async getUsers({ user, metadata = {} }: IGetUsersTabViewParams) {
    const teamIds = await this.teamsService.scopeTeamFilter(
      user,
      metadata?.filters?.teamId,
    );

    return this.usersService.search({
      filters: {
        slackTeamId: user.slack_team_id,
        ...(teamIds ? { teamIds } : {}),
        ...(metadata?.filters?.role ? { role: metadata?.filters.role } : {}),
        ...(metadata?.filters?.user ? { id: metadata?.filters.user.id } : {}),
        ...(metadata?.includeInactive
          ? { includeInactive: metadata?.includeInactive }
          : {}),
      },
      orderBy: ['name:asc'],
      page: metadata.page,
    });
  }

  // Only Admin and HR change people, so only they get the forms.
  private assertPeopleAdmin(user: IUserViewModel) {
    if (!isPeopleAdmin(user.role)) {
      throw new ForbiddenException('Only Admin and HR change users.');
    }
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
