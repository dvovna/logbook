import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import {
  ActionMapType,
  BaseActionHandler,
} from 'src/slack/common/handlers/base-action.handler';
import {
  withPagination,
  withSelectFilter,
} from 'src/slack/common/utils/tab-list.utils';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { VacationHistoryTabService } from 'src/slack/tabs/vacation-requests/services/vacation-history-tab.service';
import { VacationHistoryTabViewActionId } from 'src/slack/tabs/vacation-requests/views/vacation-history-tab.view';
import { CommonViewActionId } from 'src/slack/enums/common-view-action-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationHistoryTabView,
  type: 'block_actions',
})
export default class VacationHistoryTabActionsHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    private readonly tabNavigationService: TabNavigationService,
    protected readonly vacationHistoryTabService: VacationHistoryTabService,
  ) {
    super();

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
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
