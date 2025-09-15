import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  TeamsTabModalName,
  TeamsTabService,
} from 'src/slack/tabs/teams/services/teams-tab.service';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  ITeamsTabMetaData,
  TeamsTabViewActionId,
} from 'src/slack/tabs/teams/views/teams-tab.view';
import { ActionMapType } from 'src/slack/common/handlers/base-tab-action.handler';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from 'src/slack/common/handlers/base-admin-tab-action.handler';
import { withPagination } from 'src/slack/common/utils/tab-list.utils';
import { withMenuAction } from 'src/slack/common/utils/slack-menu.utils';

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

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [TeamsTabViewActionId.AddTeam]: this.handleAddTeam,
      [TeamsTabViewActionId.ManageTeamMenu]: withMenuAction<
        TeamsTabViewActionId,
        [IUserViewModel]
      >(this.handleManageTeamMenuAction),
      [TeamsTabViewActionId.PaginationPrev]: paginationHandler,
      [TeamsTabViewActionId.PaginationNext]: paginationHandler,
    };
  }

  private updateTab = async (
    metadata: ITeamsTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.teamsTabService.publish({
      user,
      metadata,
    });
  };

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
    actionType: TeamsTabViewActionId,
    teamId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case TeamsTabViewActionId.EditTeam: {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.UpdateTeam,
          { user, teamId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case TeamsTabViewActionId.DeleteTeam: {
        await this.teamsTabService.openModal(
          payload.trigger_id || user.slack_id,
          TeamsTabModalName.DeleteTeam,
          { user, teamId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Team Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
