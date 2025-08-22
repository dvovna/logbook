import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamModalViewService } from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import TeamsService from 'src/teams/teams.service';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { TeamsTabService } from 'src/slack/services/teams-tab.service';
import { IDeleteTeamModalViewMetadata } from 'src/slack/services/slack-views/modal-views/delete-team-modal-view.service';
import TeamDeleteError from 'src/common/errors/team-delete.error';

@Injectable()
export class DeleteTeamFormSubmitHandler {
  public constructor(
    private readonly teamModalViewService: TeamModalViewService,
    private readonly teamsService: TeamsService,
    private readonly manageTeamsTabService: TeamsTabService,
  ) {}

  public async handle(
    _payload: ISlackInteractionPayload,
    metadata: IDeleteTeamModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const { teamIdToDelete } = metadata;

    try {
      const team = await this.teamsService.delete(teamIdToDelete);

      this.manageTeamsTabService.publishManageTeamsTab(user);

      return SlackViewResponseFactory.update(
        this.teamModalViewService.getSuccessView(
          `✅ Team '${team.name}' has been successfully deleted.`,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof TeamDeleteError
          ? error.message
          : 'An error occurred while deleting the team. Please try again later.';

      return SlackViewResponseFactory.update(
        await this.manageTeamsTabService.getDeleteTeamModalView(
          teamIdToDelete,
          user,
          errorMessage,
        ),
      );
    }
  }
}
