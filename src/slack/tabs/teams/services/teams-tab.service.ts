import { Injectable } from '@nestjs/common';
import TeamsService from 'src/teams/teams.service';
import { TeamModalView } from 'src/slack/tabs/teams/views/team-modal.view';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { UsersService } from 'src/users/users.service';
import {
  ITeamsTabMetaData,
  TeamsTabView,
} from 'src/slack/tabs/teams/views/teams-tab.view';
import ConfirmationModalView from 'src/slack/common/views/confirmation-modal.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';

interface ITeamModalViewParams extends IOpenModalBaseParams {
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
    params: IOpenModalBaseParams,
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
    private readonly teamModalViewService: TeamModalView,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
    private readonly teamsTabView: TeamsTabView,
    private readonly confirmationModalViewService: ConfirmationModalView,
  ) {
    super(TabId.Teams, {
      [TeamsTabModalName.CreateTeam]: (params) =>
        this.createTeamModalView(params),
      [TeamsTabModalName.UpdateTeam]: (params) =>
        this.updateTeamModalView(params),
      [TeamsTabModalName.DeleteTeam]: (params) =>
        this.deleteTeamModalView(params),
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
      teamsData,
      usersCountByTeam,
    });
  }

  private async createTeamModalView({
    user,
    errorMessage,
  }: IOpenModalBaseParams) {
    const policies = await this.vacationPoliciesService.findMany({
      slackTeamId: user.slack_team_id,
    });

    return this.teamModalViewService.getView({
      policies,
      errorMessage,
    });
  }

  private async updateTeamModalView({
    teamId,
    user,
    errorMessage,
  }: ITeamModalViewParams) {
    const [team, policies] = await Promise.all([
      this.teamsService.findOneWithValidation({
        id: teamId,
        slackTeamId: user.slack_team_id,
      }),
      this.vacationPoliciesService.findMany({
        slackTeamId: user.slack_team_id,
      }),
    ]);

    return this.teamModalViewService.getView({
      policies,
      initialData: {
        id: team.id,
        name: team.name,
        description: team.description,
        vacation_policy_id: team.vacation_policy_id,
      },
      errorMessage,
    });
  }

  private async deleteTeamModalView({
    teamId,
    user,
    errorMessage,
  }: ITeamModalViewParams) {
    const team = await this.teamsService.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalViewService.getView({
      callbackId: ViewCallbackId.DeleteTeam,
      title: 'Delete Team',
      message: `:alert: The team *${team.name}* will be permanently deleted. This action cannot be undone.`,
      entityId: team.id,
      errorMessage,
    });
  }
}
