import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  TeamsTabModalName,
  TeamsTabService,
} from '@modules/slack/tabs/teams/services/teams-tab.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ITeamsTabMetaData } from '@modules/slack/tabs/teams/views/teams-tab.view';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { withPagination } from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TeamsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Teams),
})
export default class TeamsTabActionHandler extends BaseTabActionHandler {
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
      [TeamsTabViewActionId.CompanyRules]: this.handleCompanyRules,
      [TeamsTabViewActionId.ManageTeamMenu]: withMenuAction<
        TeamsTabViewActionId,
        [IUserViewModel]
      >(this.handleManageTeamMenuAction, this.logger),
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
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleCompanyRules = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.teamsTabService.openModal(
      payload.trigger_id || user.slack_id,
      TeamsTabModalName.CompanyRules,
      { user, pageMetadata: payload.view.private_metadata },
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
