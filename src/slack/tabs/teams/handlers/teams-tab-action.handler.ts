import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  TeamsTabModalName,
  TeamsTabService,
} from 'src/slack/tabs/teams/services/teams-tab.service';
import { OverflowAction } from '@slack/bolt';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TeamsTabViewActionId } from 'src/slack/tabs/teams/views/teams-tab.view';
import { ActionMapType } from 'src/slack/common/handlers/base-tab-action.handler';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from 'src/slack/common/handlers/base-admin-tab-action.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TeamsTabView,
  type: 'block_actions',
})
export default class TeamsTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(TeamsTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly teamsTabService: TeamsTabService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [TeamsTabViewActionId.AddTeam]: this.handleAddTeam,
      [TeamsTabViewActionId.ManageTeamMenu]: this.handleManageTeamMenuAction,
    };
  }

  private handleAddTeam = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.teamsTabService.openModal(
      payload.trigger_id || user.slack_id,
      TeamsTabModalName.CreateTeam,
      { user },
    );
  };

  private handleManageTeamMenuAction = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const selectedValue = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedValue) {
      this.logger.warn(
        `${TeamsTabViewActionId.ManageTeamMenu} triggered without selected_option`,
      );

      return;
    }

    // e.g. TeamsTabViewActionId:team_id
    const [actionType, teamId] = selectedValue.split(':');

    switch (actionType as TeamsTabViewActionId) {
      case TeamsTabViewActionId.EditTeam: {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.UpdateTeam,
          { user, teamId },
        );

        break;
      }
      case TeamsTabViewActionId.DeleteTeam: {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.DeleteTeam,
          { user, teamId },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Team Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
