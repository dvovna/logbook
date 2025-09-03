import { Injectable } from '@nestjs/common';
import TeamsService from 'src/teams/teams.service';
import { TeamModalViewService } from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { UsersService } from 'src/users/users.service';
import { TeamsTabViewService } from 'src/slack/services/slack-views/tab-views/teams-tab-view.service';
import DeleteEntityModalViewService from 'src/slack/services/slack-views/modal-views/delete-entity-modal-view.service';
import BaseTabViewService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/services/base-tab-view.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

interface ITeamModalViewParams extends IOpenModalBaseParams {
  teamId: string;
}

export enum TeamsTabModalName {
  CreateTeam = 'CreateTeam',
  UpdateTeam = 'UpdateTeam',
  DeleteTeam = 'DeleteTeam',
}

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
export class TeamsTabService extends BaseTabViewService<TeamsTabModalViewResolversMapType> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly teamModalViewService: TeamModalViewService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
    private readonly teamsTabViewService: TeamsTabViewService,
    private readonly deleteEntityModalViewService: DeleteEntityModalViewService,
  ) {
    super({
      [TeamsTabModalName.CreateTeam]: (params) =>
        this.createTeamModalView(params),
      [TeamsTabModalName.UpdateTeam]: (params) =>
        this.updateTeamModalView(params),
      [TeamsTabModalName.DeleteTeam]: (params) =>
        this.deleteTeamModalView(params),
    });
  }

  public async getTabView({ user }: IPublishBaseParams) {
    const [teams, usersCountByTeam] = await Promise.all([
      this.teamsService.findMany({ slackTeamId: user.slack_team_id }),
      this.usersService.getUsersCountByTeam(user.slack_team_id),
    ]);

    return await this.teamsTabViewService.getView({
      userId: user.slack_id,
      teams,
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
      team,
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

    return this.deleteEntityModalViewService.getView({
      callbackId: ViewCallbackId.DeleteTeam,
      entityType: 'team',
      entityName: team.name,
      entityId: team.id,
      errorMessage,
    });
  }
}
