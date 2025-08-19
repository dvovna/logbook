import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import { TeamsTabService } from 'src/slack/services/teams-tab.service';
import { OverflowAction } from '@slack/bolt';

@Injectable()
export default class TeamActionsHandler {
  private readonly logger = new Logger(TeamActionsHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    private readonly teamManagementService: TeamsTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case ViewActionId.AddTeam: {
        await this.teamManagementService.publishManageTeamModalView(
          payload.trigger_id || user.slack_id,
          user,
        );

        break;
      }
      case ViewActionId.BackToHomeTap: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      case ViewActionId.ManageTeamMenu: {
        await this.handleManageTeamMenu(payload, user);

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }

  private async handleManageTeamMenu(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedValue = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedValue) {
      this.logger.warn('AdminTeamMenu triggered without selected_option');
      return;
    }

    // value is edit_team:123 || edit_users:123
    const [actionType, id] = selectedValue.split(':');

    switch (actionType) {
      case 'edit_team': {
        await this.teamManagementService.publishManageTeamModalView(
          payload.trigger_id || user.slack_id,
          user,
          id,
        );

        break;
      }
      case 'edit_users': {
        // await this.teamManagementService.openEditUsersModal(payload, user, id);
        break;
      }
      default: {
        this.logger.warn(`Unhandled AdminTeamMenu actionType: ${actionType}`);
      }
    }
  }
}
