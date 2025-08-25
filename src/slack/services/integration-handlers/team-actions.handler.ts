import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import {
  TeamsTabModalName,
  TeamsTabService,
} from 'src/slack/services/teams-tab.service';
import { OverflowAction } from '@slack/bolt';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

@Injectable()
@SlackHandler({ callbackId: ViewCallbackId.TeamTabView, type: 'block_actions' })
export default class TeamActionsHandler {
  private readonly logger = new Logger(TeamActionsHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    private readonly teamsTabService: TeamsTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case ViewActionId.AddTeam: {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.CreateTeam,
          { user },
        );

        break;
      }
      case ViewActionId.BackToHomeTap: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      case ViewActionId.ManageTeamMenu: {
        await this.handleManageTeamMenuAction(payload, user);

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }

  private async handleManageTeamMenuAction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedValue = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedValue) {
      this.logger.warn(
        `${ViewActionId.ManageTeamMenu} triggered without selected_option`,
      );

      return;
    }

    // e.g. edit_team:team_id
    const [actionType, teamId] = selectedValue.split(':');

    switch (actionType) {
      case 'edit_team': {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.UpdateTeam,
          { user, teamId },
        );

        break;
      }
      case 'delete_team': {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.DeleteTeam,
          { user, teamId },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled AdminTeamMenu actionType: ${actionType}`);
      }
    }
  }
}
