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
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';

@Injectable()
@SlackHandler({ callbackId: ViewCallbackId.HomeTabView, type: 'block_actions' })
export default class HomeTabActionHandler extends BaseAdminTabActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(HomeTabActionHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    protected readonly tabNavigationService: TabNavigationService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [HomeTabActionId.OpenVacationModal]: this.handleCreateVacationRequest,
      [HomeTabActionId.ViewHistory]: this.handleViewHistory,
      [HomeTabActionId.ManagePendingRequestMenu]: withMenuAction(
        this.handleMenuAction,
        this.logger,
      ),
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

  private handleViewHistory = (
    _payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    this.tabNavigationService.navigate(TabId.VacationsHistory, { user });
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
        this.logger.warn(`Unhandled Team Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
