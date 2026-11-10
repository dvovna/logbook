import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import {
  withPagination,
  withResetFilters,
  withSelectFilter,
} from '@modules/slack/common/utils/tab-list.utils';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import {
  HistoryTabModalName,
  VacationHistoryTabService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-history-tab.service';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationHistoryTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.TimeOff),
})
export default class VacationHistoryTabActionsHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(VacationHistoryTabActionsHandler.name);

  public constructor(
    tabNavigationService: TabNavigationService,
    protected readonly vacationHistoryTabService: VacationHistoryTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [VacationHistoryTabViewActionId.ManageRequestMenu]: withMenuAction<
        VacationHistoryTabViewActionId,
        [IUserViewModel]
      >(this.handleManageRequestMenuAction, this.logger),
      // With the tab's metadata, so the form re-renders this tab when sent.
      [VacationHistoryTabViewActionId.RequestTimeOff]: (payload, user) =>
        this.vacationHistoryTabService.openModal(
          payload.trigger_id || user.slack_id,
          HistoryTabModalName.RequestTimeOff,
          { user, pageMetadata: payload.view.private_metadata },
        ),
      [VacationHistoryTabViewActionId.PaginationPrev]: paginationHandler,
      [VacationHistoryTabViewActionId.PaginationNext]: paginationHandler,
      [VacationHistoryTabViewActionId.FilterRequestsByYear]: withSelectFilter(
        'year',
        this.updateTab,
      ),
      [VacationHistoryTabViewActionId.FilterRequestsByType]: withSelectFilter(
        'type',
        this.updateTab,
      ),
      [VacationHistoryTabViewActionId.FilterRequestsByStatus]: withSelectFilter(
        'status',
        this.updateTab,
      ),
      [VacationHistoryTabViewActionId.ResetFilters]: withResetFilters(
        this.updateTab,
      ),
    };
  }

  private updateTab = async (
    metadata: IVacationRequestsTabMetadata,
    user: IUserViewModel,
  ) => {
    await this.vacationHistoryTabService.publish({
      user,
      metadata,
    });
  };

  private handleManageRequestMenuAction = async (
    actionType: VacationHistoryTabViewActionId,
    requestId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case VacationHistoryTabViewActionId.ViewDetails: {
        await this.vacationHistoryTabService.openModal(
          payload.trigger_id || user.slack_id,
          HistoryTabModalName.ViewRequestDetails,
          {
            user,
            requestId,
            pageMetadata: payload.view.private_metadata,
          },
        );

        break;
      }
      default:
        this.logger.warn(`Unknown action type: ${actionType}`);
        break;
    }
  };
}
