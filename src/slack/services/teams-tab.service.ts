import { Injectable } from '@nestjs/common';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import TeamsService from 'src/teams/teams.service';
import { TeamModalViewService } from 'src/slack/services/slack-views/team-modal-view.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { UsersService } from 'src/users/users.service';
import { TeamManagementTabViewService } from 'src/slack/services/slack-views/team-management-tab-view.service';
import DeleteTeamModalViewService from 'src/slack/services/slack-views/delete-team-modal-view.service';

@Injectable()
export class TeamsTabService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly teamsService: TeamsService,
    private readonly teamModalViewService: TeamModalViewService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
    private readonly manageTeamsViewService: TeamManagementTabViewService,
    private readonly deleteTeamModalViewService: DeleteTeamModalViewService,
  ) {}

  public async publishManageTeamsTab(user: IUserViewModel) {
    const [teams, usersCountByTeam] = await Promise.all([
      this.teamsService.findMany({ slackTeamId: user.slack_team_id }),
      this.usersService.getUsersCountByTeam(user.slack_team_id),
    ]);

    await this.slackCommunicationService.publishView(
      await this.manageTeamsViewService.getView({
        userId: user.slack_id,
        teams,
        usersCountByTeam,
      }),
      user.slack_team_id,
    );
  }

  public async publishManageTeamModalView(
    triggerId: string,
    user: IUserViewModel,
    teamId: string | null = null,
    errorMessage?: string,
  ) {
    await this.slackCommunicationService.openView(
      triggerId,
      await this.getTeamModalView(user, teamId, errorMessage),
      user.slack_team_id,
    );
  }

  public async getTeamModalView(
    user: IUserViewModel,
    teamId: string | null,
    generalError?: string,
  ) {
    const team = teamId
      ? await this.teamsService.findOne({
          id: teamId,
          slackTeamId: user.slack_team_id,
        })
      : null;
    const policies = await this.vacationPoliciesService.findMany({
      slackTeamId: user.slack_team_id,
    });

    return this.teamModalViewService.getView({
      policies,
      team,
      generalError,
    });
  }

  public async publishDeleteTeamModalView(
    triggerId: string,
    user: IUserViewModel,
    teamId: string,
  ) {
    await this.slackCommunicationService.openView(
      triggerId,
      await this.getDeleteTeamModalView(teamId, user),
      user.slack_team_id,
    );
  }

  public async getDeleteTeamModalView(
    teamId: string,
    user: IUserViewModel,
    generalError?: string,
  ) {
    const team = teamId
      ? await this.teamsService.findOne({
        id: teamId,
        slackTeamId: user.slack_team_id,
      })
      : null;

    if (!team) {
      throw new Error('Team not found');
    }

    return this.deleteTeamModalViewService.getView({ team, generalError });
  }
}
