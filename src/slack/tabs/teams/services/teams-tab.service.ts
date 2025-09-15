import { Injectable } from '@nestjs/common';
import TeamsService from 'src/teams/services/teams.service';
import { TeamModalView } from 'src/slack/tabs/teams/views/team-modal.view';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { UsersService } from 'src/users/users.service';
import {
  ITeamsTabMetaData,
  TeamsTabView,
} from 'src/slack/tabs/teams/views/teams-tab.view';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import UserRole from 'src/common/enums/user-role.enum';

interface ITeamModalViewParams extends IOpenModalBaseParams<string> {
  teamId: string;
}

export enum TeamsTabModalName {
  CreateTeam = 'CreateTeam',
  UpdateTeam = 'UpdateTeam',
  DeleteTeam = 'DeleteTeam',
}

interface IGetTeamsTabViewParams extends IPublishBaseParams {
  metadata?: ITeamsTabMetaData;
}

const TEAMS_TAB_PAGE_SIZE = 5;

type TeamsTabModalViewResolversMapType = {
  [TeamsTabModalName.CreateTeam]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
  [TeamsTabModalName.UpdateTeam]: (
    params: ITeamModalViewParams,
  ) => Promise<View>;
  [TeamsTabModalName.DeleteTeam]: (
    params: ITeamModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class TeamsTabService extends BaseTabService<TeamsTabModalViewResolversMapType> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly teamModalView: TeamModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
    private readonly teamsTabView: TeamsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Teams, {
      [TeamsTabModalName.CreateTeam]: (params) =>
        this.getCreateTeamModalView(params),
      [TeamsTabModalName.UpdateTeam]: (params) =>
        this.getUpdateTeamModalView(params),
      [TeamsTabModalName.DeleteTeam]: (params) =>
        this.getDeleteTeamModalView(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetTeamsTabViewParams) {
    const [teamsData, usersCountByTeam] = await Promise.all([
      this.teamsService.search({
        filters: { slackTeamId: user.slack_team_id },
        orderBy: ['is_primary:desc', 'name:asc'],
        page: metadata.page,
        pageSize: TEAMS_TAB_PAGE_SIZE,
      }),
      this.usersService.getUsersCountByTeam(user.slack_team_id),
    ]);

    return await this.teamsTabView.getView({
      userId: user.slack_id,
      userRole: user.role,
      teamsData,
      usersCountByTeam,
    });
  }

  private async getCreateTeamModalView({
    user,
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    const policies = await this.vacationPoliciesService.findMany({
      slackTeamId: user.slack_team_id,
    });

    return this.teamModalView.getView(
      {
        policies,
        errorMessage,
        managers: [],
        hrUsers: [],
      },
      {
        pageMetadata,
      },
    );
  }

  private async getUpdateTeamModalView({
    teamId,
    user,
    pageMetadata,
    errorMessage,
  }: ITeamModalViewParams) {
    const [team, policies, users] = await Promise.all([
      this.teamsService.findOneWithValidation({
        id: teamId,
        slackTeamId: user.slack_team_id,
      }),
      this.vacationPoliciesService.findMany({
        slackTeamId: user.slack_team_id,
      }),
      this.usersService.findMany({
        slackTeamId: user.slack_team_id,
        roles: [UserRole.HR, UserRole.Manager, UserRole.Admin],
      }),
    ]);

    const managers = users
      .filter((user) => [UserRole.Manager, UserRole.Admin].includes(user.role))
      .map((user) => ({ name: user.name, id: user.id }));

    const hrUsers = users
      .filter((user) => [UserRole.HR, UserRole.Admin].includes(user.role))
      .map((user) => ({ name: user.name, id: user.id }));

    return this.teamModalView.getView(
      {
        policies,
        initialData: {
          id: team.id,
          name: team.name,
          description: team.description,
          vacation_policy_id: team.vacation_policy_id,
          managerApprovers: team.manager_approvers || undefined,
          hrApprovers: team.hr_approvers || undefined,
          approvalNotificationRecipients:
            team.approval_notification_recipients || undefined,
          managerApproversRule: team.manager_approvers_rule,
          hrApproversRule: team.hr_approvers_rule,
        },
        errorMessage,
        managers,
        hrUsers,
      },
      { id: team.id, pageMetadata },
    );
  }

  private async getDeleteTeamModalView({
    teamId,
    user,
    errorMessage,
    pageMetadata,
  }: ITeamModalViewParams) {
    const team = await this.teamsService.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteTeam,
        title: 'Delete Team',
        message: `:alert: The team *${team.name}* will be permanently deleted. This action cannot be undone.`,
        errorMessage,
      },
      {
        id: team.id,
        pageMetadata,
      },
    );
  }
}
