import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  IGetTeamModalViewMetadata,
  TeamModalViewService,
} from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import TeamsService from 'src/teams/teams.service';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import TeamModalViewValuesParser, {
  ITeamFormViewData,
} from 'src/slack/services/slack-views/parsers/team-modal-view-values.parser';
import { TeamsTabService } from 'src/slack/services/teams-tab.service';
import MaxTeamsCountReachedError from 'src/common/errors/max-teams-count-reached.error';

@Injectable()
export class TeamFormSubmitHandler {
  public constructor(
    private readonly teamModalViewValuesParser: TeamModalViewValuesParser,
    private readonly teamModalViewService: TeamModalViewService,
    private readonly teamsService: TeamsService,
    private readonly manageTeamsTabService: TeamsTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    metadata: IGetTeamModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const { view } = payload;
    const { teamIdToEdit } = metadata;

    const { data, errors } = this.teamModalViewValuesParser.parse(
      view.state.values,
    );

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const team = await this.createOrUpdateTeam(data, teamIdToEdit, user);

      this.manageTeamsTabService.publishManageTeamsTab(user);

      return SlackViewResponseFactory.update(
        this.teamModalViewService.getSuccessView(
          `✅ Team '${team.name}' was ${teamIdToEdit ? 'updated' : 'created'} successfully!`,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof MaxTeamsCountReachedError
          ? error.message
          : 'An error occurred while creating or updating the team. Please try again later.';

      return SlackViewResponseFactory.update(
        await this.manageTeamsTabService.getTeamModalView(
          user,
          teamIdToEdit,
          errorMessage,
        ),
      );
    }
  }

  private createOrUpdateTeam(
    data: ITeamFormViewData,
    teamIdToEdit: string | null,
    user: IUserViewModel,
  ) {
    if (teamIdToEdit) {
      return this.teamsService.update(
        {
          id: teamIdToEdit,
          slackTeamId: user.slack_team_id,
        },
        {
          name: data.name,
          description: data.description,
          vacationPolicyId: data.policy_id,
        },
        user,
      );
    }

    return this.teamsService.create(
      {
        name: data.name,
        description: data.description,
        vacationPolicyId: data.policy_id,
        slackTeamId: user.slack_team_id,
      },
      user,
    );
  }
}
