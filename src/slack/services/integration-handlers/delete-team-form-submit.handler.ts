import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamModalViewService } from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import TeamsService from 'src/teams/teams.service';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import {
  TeamsTabModalName,
  TeamsTabService,
} from 'src/slack/services/teams-tab.service';
import { IDeleteTeamModalViewMetadata } from 'src/slack/services/slack-views/modal-views/delete-team-modal-view.service';
import TeamDeleteError from 'src/common/errors/team-delete.error';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteTeam,
  type: 'view_submission',
})
export class DeleteTeamFormSubmitHandler {
  public constructor(
    private readonly teamModalViewService: TeamModalViewService,
    private readonly teamsService: TeamsService,
    private readonly teamsTabService: TeamsTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IDeleteTeamModalViewMetadata>(payload);

    const { teamIdToDelete } = metadata;

    try {
      const team = await this.teamsService.delete(teamIdToDelete);

      this.teamsTabService.publish({ user });

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
        await this.teamsTabService.getModalView(TeamsTabModalName.DeleteTeam, {
          teamId: teamIdToDelete,
          user,
          errorMessage,
        }),
      );
    }
  }
}
