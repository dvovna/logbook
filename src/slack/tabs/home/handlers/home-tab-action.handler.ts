import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  HomeTabModalName,
  HomeTabService,
} from '@modules/slack/tabs/home/services/home-tab.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HomeTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Home),
})
export default class HomeTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(HomeTabActionHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    private readonly timeEntriesService: TimeEntriesService,
    protected readonly tabNavigationService: TabNavigationService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [HomeTabActionId.OpenVacationModal]: this.handleCreateVacationRequest,
      [HomeTabActionId.EditTimeEntries]: this.handleViewTimeEntries,
      [HomeTabActionId.ManagePendingRequestMenu]: withMenuAction(
        this.handleMenuAction,
        this.logger,
      ),
      [HomeTabActionId.LogTime]: this.handleLogTime,
      [HomeTabActionId.SubmitTimeEntries]: this.handleSubmitTimeEntries,
    };
  }

  private handleCreateVacationRequest = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.homeTabService.openModal(
      payload.trigger_id || user.slack_id,
      HomeTabModalName.CreateVacationRequest,
      { user },
    );
  };

  private handleLogTime = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.homeTabService.openModal(
      payload.trigger_id || user.slack_id,
      HomeTabModalName.CreateTimeEntry,
      { user },
    );
  };

  // Sends all of the user's drafts and rejected entries for approval, then
  // shows Home without the reminder.
  private handleSubmitTimeEntries = async (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.timeEntriesService.submit(
      { slackTeamId: user.slack_team_id },
      user,
    );

    this.tabNavigationService.navigate(TabId.Home, { user });
  };

  private handleViewTimeEntries = (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    this.tabNavigationService.navigate(TabId.TimeEntries, {
      user,
      metadata: { ownEntriesOnly: true },
    });
  };

  private handleMenuAction = async (
    actionType: HomeTabActionId,
    requestId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case HomeTabActionId.ViewDetails: {
        return this.homeTabService.openModal(
          payload.trigger_id || user.slack_id,
          HomeTabModalName.ViewVacationRequest,
          { user, requestId },
        );
      }
      case HomeTabActionId.CancelRequest: {
        return this.homeTabService.openModal(
          payload.trigger_id || user.slack_id,
          HomeTabModalName.CancelVacationRequest,
          { user, requestId },
        );
      }
      default: {
        this.logger.warn(`Unhandled Home Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
