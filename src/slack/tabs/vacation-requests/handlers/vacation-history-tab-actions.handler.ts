import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
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
import { CommonViewActionId } from '@modules/slack/enums/common-view-action-id.enum';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationHistoryTabView,
  type: 'block_actions',
})
export default class VacationHistoryTabActionsHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(VacationHistoryTabActionsHandler.name);

  public constructor(
    private readonly tabNavigationService: TabNavigationService,
    protected readonly vacationHistoryTabService: VacationHistoryTabService,
  ) {
    super();

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [VacationHistoryTabViewActionId.ManageRequestMenu]: withMenuAction<
        VacationHistoryTabViewActionId,
        [IUserViewModel]
      >(this.handleManageRequestMenuAction, this.logger),
      [CommonViewActionId.BackToHomeTab]: (_payload, user) => {
        this.tabNavigationService.navigate(TabId.Home, { user });
      },
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
