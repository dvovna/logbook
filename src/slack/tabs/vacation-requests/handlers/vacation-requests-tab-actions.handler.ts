import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  IVacationRequestsTabMetadata,
  VacationRequestsTabViewActionId,
} from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import {
  VacationRequestsTabModalName,
  VacationRequestsTabService,
} from 'src/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { ActionMapType } from 'src/slack/common/handlers/base-action.handler';
import {
  withSelectFilter,
  withPagination,
  withAsyncSelectFilter,
} from 'src/slack/common/utils/tab-list.utils';
import { withMenuAction } from 'src/slack/common/utils/slack-menu.utils';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from 'src/slack/common/handlers/base-admin-tab-action.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationRequestsTabView,
  type: 'block_actions',
})
export default class VacationRequestsTabActionsHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(VacationRequestsTabActionsHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    protected readonly vacationRequestsTabService: VacationRequestsTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [VacationRequestsTabViewActionId.CreateRequest]: this.handleCreateRequest,
      [VacationRequestsTabViewActionId.ManageRequestMenu]: withMenuAction<
        VacationRequestsTabViewActionId,
        [IUserViewModel]
      >(this.handleManageRequestMenuAction),
      [VacationRequestsTabViewActionId.PaginationPrev]: paginationHandler,
      [VacationRequestsTabViewActionId.PaginationNext]: paginationHandler,
      [VacationRequestsTabViewActionId.FilterRequestsByStatus]:
        withSelectFilter('status', this.updateTab),
      [VacationRequestsTabViewActionId.FilterRequestsByTeam]: withSelectFilter(
        'teamId',
        this.updateTab,
      ),
      [VacationRequestsTabViewActionId.FilterRequestsByYear]: withSelectFilter(
        'year',
        this.updateTab,
      ),
      [VacationRequestsTabViewActionId.FilterRequestsByType]: withSelectFilter(
        'type',
        this.updateTab,
      ),
      [VacationRequestsTabViewActionId.FilterRequestsByUser]:
        withAsyncSelectFilter('user', this.updateTab),
    };
  }

  private handleCreateRequest = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.vacationRequestsTabService.openModal(
      payload.trigger_id || user.slack_id,
      VacationRequestsTabModalName.CreateRequest,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private updateTab = async (
    metadata: IVacationRequestsTabMetadata,
    user: IUserViewModel,
  ) => {
    await this.vacationRequestsTabService.publish({
      user,
      metadata,
    });
  };

  private handleManageRequestMenuAction = async (
    actionType: VacationRequestsTabViewActionId,
    requestId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case VacationRequestsTabViewActionId.EditRequest: {
        await this.vacationRequestsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationRequestsTabModalName.UpdateRequest,
          { user, requestId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case VacationRequestsTabViewActionId.DeleteRequest: {
        await this.vacationRequestsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationRequestsTabModalName.DeleteRequest,
          { user, requestId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(
          `Unhandled Vacation Request Menu actionType: ${actionType}`,
        );
      }
    }
  };
}
