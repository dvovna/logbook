import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import {
  ActionMapType,
  BaseTabActionHandler,
} from 'src/slack/common/handlers/base-tab-action.handler';
import {
  withSelectFilter,
  withPagination,
} from 'src/slack/common/utils/tab-list.utils';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { VacationHistoryTabService } from 'src/slack/tabs/vacation-requests/services/vacation-history-tab.service';
import { VacationHistoryTabViewActionId } from 'src/slack/tabs/vacation-requests/views/vacation-history-tab.view';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationHistoryTabView,
  type: 'block_actions',
})
export default class VacationHistoryTabActionsHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    protected readonly vacationHistoryTabService: VacationHistoryTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
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
}
