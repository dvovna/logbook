import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { truncate } from 'lodash';
import { FiltersBlockBuilder, IFiltersConfig } from '@modules/slack/common/views/builders/filters-block.builder';
import {
  TimeEntriesTabViewActionId,
} from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import {
  ITimeEntriesListFilters,
  ITimeEntryListData,
  ITimeEntryListItem,
} from 'src/time-entries/types/time-entries-list.types';
import { TIME_ENTRIES_TAB_PAGE_SIZE } from '@modules/slack/tabs/time-tracking/services/time-entries-tab-data.service';
import { getDisplayTime } from '@common/utils/time.utils';

interface IGetTimeEntriesViewParams extends IBaseTabViewParams {
  timeEntriesListData: ITimeEntryListData;
}

export interface ITimeEntriesTabMetaData {
  page?: number;
  filters?: ITimeEntriesListFilters;
}

@Injectable()
export class TimeEntriesTabView extends BaseAdminTabView<
  IGetTimeEntriesViewParams,
  ITimeEntriesTabMetaData
> {
  protected callbackId = ViewCallbackId.TimeEntriesTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageTimeAndBilling;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '⏱ *Time Entries*\n\nReview and manage logged working time.';
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Time Entry' },
      action_id: TimeEntriesTabViewActionId.AddTimeEntry,
    };
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManageTimeAndBilling);
  }

  protected getContentBlocks(
    { timeEntriesListData }: IGetTimeEntriesViewParams,
    { filters, page }: ITimeEntriesTabMetaData,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push(...this.getFiltersBlocks(filters));

    const listBlocks = PaginatedListView.getBlocks<ITimeEntryListItem>({
      itemsData: {
        ...timeEntriesListData,
        page: page || 1,
        pageSize: TIME_ENTRIES_TAB_PAGE_SIZE,
      },
      getItemBlocks: (item) =>
        this.getTimeEntryListItemBlocks(item),
      prevPageActionId: TimeEntriesTabViewActionId.PaginationPrev,
      nextPageActionId: TimeEntriesTabViewActionId.PaginationNext,
      emptyText: '_No time entries found_',
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getTimeEntryListItemBlocks(
    entry: ITimeEntryListItem,
  ): AnyBlock[] {
    const workDate = new Date(entry.work_date).toLocaleDateString();
    const createdAt = new Date(entry.created_at).toLocaleDateString();

    return [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text:
              `*${entry.user_name}*\n` +
              `Project: ${entry.project_name || '-'}\n` +
              `Client: ${entry.client_name || '-'}\n`,
          },
          {
            type: 'mrkdwn',
            text:
              `Date: ${workDate}\n` +
              `Time: ${getDisplayTime(entry.minutes)}\n` +
              `Created: ${createdAt}\n` +
              `Description: ${truncate(entry.description || '-', { length: 80 })}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: TimeEntriesTabViewActionId.ManageTimeEntryMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit' },
              value: `${TimeEntriesTabViewActionId.EditTimeEntry}:${entry.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Delete' },
              value: `${TimeEntriesTabViewActionId.DeleteTimeEntry}:${entry.id}`,
            },
          ],
        },
      },
      ...Divider.getBlocks(),
    ];
  }

  private getFiltersBlocks(filters?: ITimeEntriesListFilters) {
    const filtersConfig: IFiltersConfig[] = [
      {
        type: 'external_select',
        actionId: TimeEntriesTabViewActionId.FilterByUser,
        placeholder: 'User',
        minQueryLength: 2,
        initialOption: filters?.user,
      },
      {
        type: 'external_select',
        actionId: TimeEntriesTabViewActionId.FilterByProject,
        placeholder: 'Project',
        minQueryLength: 2,
        initialOption: filters?.project,
      },
      {
        type: 'datepicker',
        actionId: TimeEntriesTabViewActionId.FilterByFromDate,
        placeholder: 'From Date',
        initialValue: filters?.fromDate || undefined,
      },
      {
        type: 'datepicker',
        actionId: TimeEntriesTabViewActionId.FilterByToDate,
        placeholder: 'To Date',
        initialValue: filters?.toDate || undefined,
      },
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: filtersConfig,
      separator: false,
      resetButtonActionId: TimeEntriesTabViewActionId.ResetFilters,
    });
  }
}
