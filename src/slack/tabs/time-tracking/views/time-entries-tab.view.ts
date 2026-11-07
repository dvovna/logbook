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
import {
  FiltersBlockBuilder,
  IFiltersConfig,
} from '@modules/slack/common/views/builders/filters-block.builder';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import {
  ITimeEntriesListFilters,
  ITimeEntryListData,
  ITimeEntryListItem,
} from 'src/time-entries/types/time-entries-list.types';
import { TIME_ENTRIES_TAB_PAGE_SIZE } from '@modules/slack/tabs/time-tracking/services/time-entries-tab-data.service';
import { getDisplayTime } from '@common/utils/time.utils';
import { TIME_ENTRY_STATUS_DISPLAY_NAME } from '@modules/slack/tabs/time-tracking/data/time-log-status.options';
import UserRole from '@common/enums/user-role.enum';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { isOpenTimeEntry } from 'src/time-entries/constants/open-time-entry-statuses';

interface IGetTimeEntriesViewParams extends IBaseTabViewParams {
  timeEntriesListData: ITimeEntryListData;
  // Only a list of everyone's entries can be narrowed down to one user.
  canFilterByUser: boolean;
  // The viewer's users.id: their own entries have more actions.
  viewerId: string;
  // The viewer's drafts and rejected entries, on their own list.
  openEntriesCount: number;
}

export interface ITimeEntriesTabMetaData {
  page?: number;
  filters?: ITimeEntriesListFilters;
  // Opened from Home → Edit Entries: the viewer's entries even for Admin/HR.
  ownEntriesOnly?: boolean;
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

  // Back to where the tab was opened from: Home or Time & Billing.
  protected getBackButtonBlocks({
    backButtonActionId,
  }: IGetTimeEntriesViewParams): AnyBlock[] {
    return BackButton.getBlocks(
      backButtonActionId ?? AdminNavigationActionId.ManageTimeAndBilling,
    );
  }

  protected getContentBlocks(
    {
      timeEntriesListData,
      canFilterByUser,
      viewerId,
      userRole,
      openEntriesCount,
    }: IGetTimeEntriesViewParams,
    { filters, page }: ITimeEntriesTabMetaData,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    if (openEntriesCount > 0) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: `📤 Submit drafts (${openEntriesCount})`,
            },
            style: 'primary',
            action_id: TimeEntriesTabViewActionId.SubmitDrafts,
          },
        ],
      });
    }

    blocks.push(...this.getFiltersBlocks(canFilterByUser, filters));

    const listBlocks = PaginatedListView.getBlocks<ITimeEntryListItem>({
      itemsData: {
        ...timeEntriesListData,
        page: page || 1,
        pageSize: TIME_ENTRIES_TAB_PAGE_SIZE,
      },
      getItemBlocks: (item) =>
        this.getTimeEntryListItemBlocks(item, viewerId, userRole),
      prevPageActionId: TimeEntriesTabViewActionId.PaginationPrev,
      nextPageActionId: TimeEntriesTabViewActionId.PaginationNext,
      emptyText: '_No time entries found_',
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getTimeEntryListItemBlocks(
    entry: ITimeEntryListItem,
    viewerId: string,
    userRole: UserRole,
  ): AnyBlock[] {
    const workDate = new Date(entry.work_date).toLocaleDateString();
    const createdAt = new Date(entry.created_at).toLocaleDateString();
    const menuOptions = this.getMenuOptions(entry, viewerId, userRole);

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
              `Status: ${TIME_ENTRY_STATUS_DISPLAY_NAME[entry.status]}\n` +
              `Created: ${createdAt}\n` +
              `Description: ${truncate(entry.description || '-', { length: 80 })}`,
          },
        ],
        ...(menuOptions.length
          ? {
              accessory: {
                type: 'overflow',
                action_id: TimeEntriesTabViewActionId.ManageTimeEntryMenu,
                options: menuOptions,
              },
            }
          : {}),
      },
      ...Divider.getBlocks(),
    ];
  }

  // The owner changes and submits only drafts and rejected entries; Admin and
  // HR change any entry.
  private getMenuOptions(
    entry: ITimeEntryListItem,
    viewerId: string,
    userRole: UserRole,
  ) {
    const isOpen = isOpenTimeEntry(entry.status);
    const canChange = isOpen || isTimeEntriesAdmin(userRole);
    const items = [
      ...(canChange
        ? [{ id: TimeEntriesTabViewActionId.EditTimeEntry, name: 'Edit' }]
        : []),
      ...(isOpen && entry.user_id === viewerId
        ? [{ id: TimeEntriesTabViewActionId.SubmitTimeEntry, name: 'Submit' }]
        : []),
      ...(canChange
        ? [{ id: TimeEntriesTabViewActionId.DeleteTimeEntry, name: 'Delete' }]
        : []),
    ];

    return items.map(({ id, name }) => ({
      text: { type: 'plain_text' as const, text: name },
      value: `${id}:${entry.id}`,
    }));
  }

  private getFiltersBlocks(
    canFilterByUser: boolean,
    filters?: ITimeEntriesListFilters,
  ) {
    const filtersConfig: IFiltersConfig[] = [
      ...(canFilterByUser
        ? [
            {
              type: 'external_select',
              actionId: TimeEntriesTabViewActionId.FilterByUser,
              placeholder: 'User',
              minQueryLength: 2,
              initialOption: filters?.user,
            } as const,
          ]
        : []),
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
