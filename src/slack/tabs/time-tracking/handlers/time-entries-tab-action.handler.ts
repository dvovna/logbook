import type { ButtonAction } from '@slack/bolt';
import { weekDays, weekStartOf } from '@common/utils/period-presets';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { ValidationError } from '@common/errors/validation.error';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import {
  withAsyncSelectFilter,
  withDateFilter,
  withPagination,
  withResetFilters,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeEntriesTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.TimeEntries),
})
export default class TimeEntriesTabActionHandler extends BaseTabActionHandler {
  private readonly logger = new Logger(TimeEntriesTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly timeEntriesTabService: TimeEntriesTabService,
    private readonly timeEntriesService: TimeEntriesService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [TimeEntriesTabViewActionId.AddTimeEntry]: this.handleAddEntry,
      [TimeEntriesTabViewActionId.SubmitWeek]: (payload, user) =>
        this.submit(payload, user),
      [TimeEntriesTabViewActionId.PreviousWeek]: this.handleWeekChange,
      [TimeEntriesTabViewActionId.NextWeek]: this.handleWeekChange,
      [TimeEntriesTabViewActionId.FillWeek]: this.handleFillWeek,
      [TimeEntriesTabViewActionId.FillDay]: this.handleFillDay,
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

  // The button's value is the Monday it goes to; it comes from the client, so
  // it has to be a date, and is turned into its week's Monday.
  private handleWeekChange = async (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => {
    const { value } = payload.actions[0] as ButtonAction;

    if (!value || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      return;
    }

    await this.updateTab(
      {
        ...parseMetadata<ITimeEntriesTabMetaData>(payload),
        weekStart: weekStartOf(value),
        page: 1,
      },
      user,
    );
  };

  // Fill in the week: the shown week of the viewer's own time. The tab's
  // metadata goes along, to show it again after saving.
  private handleFillWeek = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const { weekStart } = parseMetadata<ITimeEntriesTabMetaData>(payload);

    await this.timeEntriesTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeEntriesTabModalName.FillWeek,
      {
        user,
        metadata: {
          mode: 'week',
          weekStart: weekStartOf(
            weekStart ?? new Date().toISOString().slice(0, 10),
          ),
          addedProjectIds: [],
          showWeekend: false,
          pageMetadata: payload.view.private_metadata,
        },
      },
    );
  };

  // Fill in today: the day form for today, the viewer's own time.
  private handleFillDay = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const today = new Date().toISOString().slice(0, 10);

    await this.timeEntriesTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeEntriesTabModalName.FillWeek,
      {
        user,
        metadata: {
          mode: 'day',
          weekStart: weekStartOf(today),
          date: today,
          addedProjectIds: [],
          showWeekend: false,
          pageMetadata: payload.view.private_metadata,
        },
      },
    );
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

  // Sends the user's entry `entryId`, or the drafts and rejected entries of
  // the shown week, for approval and shows the result. An entry already
  // submitted in the meantime just shows up as such.
  private submit = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
    entryId?: string,
  ) => {
    const metadata = parseMetadata<ITimeEntriesTabMetaData>(payload);
    const days = entryId
      ? undefined
      : weekDays(
          metadata.weekStart ??
            weekStartOf(new Date().toISOString().slice(0, 10)),
        );

    try {
      await this.timeEntriesService.submit(
        {
          id: entryId,
          slackTeamId: user.slack_team_id,
          dateFrom: days?.[0],
          dateTo: days?.[6],
        },
        user,
      );
    } catch (error) {
      if (!(
        error instanceof ValidationError || error instanceof ForbiddenException
      )) {
        throw error;
      }

      this.logger.warn(`Time entry not submitted: ${error.message}`);
    }

    await this.updateTab(metadata, user);
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
      case TimeEntriesTabViewActionId.SubmitTimeEntry: {
        await this.submit(payload, user, entryId);

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
        this.logger.warn(
          `Unhandled Time Entries Tab Menu actionType: ${actionType}`,
        );
      }
    }
  };
}
