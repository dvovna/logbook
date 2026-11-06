import { Injectable, Logger } from '@nestjs/common';
import {
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import {
  withAsyncSelectFilter,
  withDateFilter,
  withPagination,
  withResetFilters,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import {
  TimeEntriesTabService,
} from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import {
  TimeEntriesTabViewActionId,
} from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeEntriesTabView,
  type: 'block_actions',
})
export default class TimeEntriesTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(TimeEntriesTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly timeEntriesTabService: TimeEntriesTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [TimeEntriesTabViewActionId.AddTimeEntry]: this.handleAddEntry,
      [TimeEntriesTabViewActionId.ManageTimeEntryMenu]: withMenuAction<
        TimeEntriesTabViewActionId,
        [IUserViewModel]
      >(this.handleManageTimeEntryMenuAction, this.logger),
      [TimeEntriesTabViewActionId.PaginationPrev]: paginationHandler,
      [TimeEntriesTabViewActionId.PaginationNext]: paginationHandler,
      [TimeEntriesTabViewActionId.FilterByUser]: withAsyncSelectFilter(
        'user',
        this.updateTab,
      ),
      [TimeEntriesTabViewActionId.FilterByProject]: withAsyncSelectFilter(
        'project',
        this.updateTab,
      ),
      [TimeEntriesTabViewActionId.FilterByFromDate]: withDateFilter(
        'fromDate',
        this.updateTab,
      ),
      [TimeEntriesTabViewActionId.FilterByToDate]: withDateFilter(
        'toDate',
        this.updateTab,
      ),
      [TimeEntriesTabViewActionId.ResetFilters]: withResetFilters(
        this.updateTab,
      ),
    };
  }

  private updateTab = async (
    metadata: ITimeEntriesTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.timeEntriesTabService.publish({
      user,
      metadata,
    });
  };

  private handleAddEntry = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.timeEntriesTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeEntriesTabModalName.CreateTimeEntry,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleManageTimeEntryMenuAction = async (
    actionType: TimeEntriesTabViewActionId,
    entryId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const triggerId = payload.trigger_id || user.slack_id;
    const params = {
      user,
      entryId,
      pageMetadata: payload.view.private_metadata,
    };

    switch (actionType) {
      case TimeEntriesTabViewActionId.EditTimeEntry: {
        await this.timeEntriesTabService.openModal(
          triggerId,
          TimeEntriesTabModalName.UpdateTimeEntry,
          params,
        );

        break;
      }
      case TimeEntriesTabViewActionId.DeleteTimeEntry: {
        await this.timeEntriesTabService.openModal(
          triggerId,
          TimeEntriesTabModalName.DeleteEntry,
          params,
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Time Entries Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
