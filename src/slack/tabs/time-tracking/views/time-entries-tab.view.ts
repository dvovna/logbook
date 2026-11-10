import {
  TIME_ENTRY_STATUS_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { formatDay } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
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
import UserRole from '@common/enums/user-role.enum';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import pluralize from 'pluralize';
import {
  TimesheetTableView,
  weekLabel,
} from '@modules/slack/tabs/time-tracking/views/timesheet-table.view';
import {
  ITimesheetOpenBefore,
  ITimesheetWeek,
} from 'src/time-entries/types/timesheet.types';
import { splitIntoRows } from '@modules/slack/common/views/components/actions-rows';
import { shiftWeek } from '@common/utils/period-presets';
import { isOpenTimeEntry } from 'src/time-entries/constants/open-time-entry-statuses';

interface IGetTimeEntriesViewParams extends IBaseTabViewParams {
  timeEntriesListData: ITimeEntryListData;
  // Only a list of everyone's entries can be narrowed down to one user.
  canFilterByUser: boolean;
  // The viewer's users.id: their own entries have more actions.
  viewerId: string;
  // The shown week of the viewer's own time (My time); Time logs has none.
  week?: ITimesheetWeek;
  // The viewer's drafts and rejected entries before the shown week.
  openBefore?: ITimesheetOpenBefore | null;
  // The minutes of each day on the page, over all its entries.
  dayTotals: Record<string, number>;
  // The entries on the page that are in a billing snapshot: locked.
  billedIds: Set<string>;
}

export interface ITimeEntriesTabMetaData {
  page?: number;
  filters?: ITimeEntriesListFilters;
  // Opened from Home → Edit Entries: the viewer's entries even for Admin/HR.
  ownEntriesOnly?: boolean;
  // My time: the Monday of the shown week, today's week when it is left out.
  weekStart?: string;
}

@Injectable()
export class TimeEntriesTabView extends BaseTabView<
  IGetTimeEntriesViewParams,
  ITimeEntriesTabMetaData
> {
  protected callbackId = ViewCallbackId.TimeEntriesTabView;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  // My time, or Time logs: everyone's entries, for Admin and HR.
  protected getTabTitle({ canFilterByUser }: IGetTimeEntriesViewParams) {
    return canFilterByUser
      ? `*${SCREENS[ScreenId.TimeLogs].title}*\nEveryone's logged time.`
      : `*${SCREENS[ScreenId.MyTime].title}*`;
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Time Entry' },
      action_id: TimeEntriesTabViewActionId.AddTimeEntry,
    };
  }

  protected getContentBlocks(
    {
      timeEntriesListData,
      canFilterByUser,
      viewerId,
      userRole,
      week,
      openBefore,
      dayTotals,
      billedIds,
    }: IGetTimeEntriesViewParams,
    { filters, page }: ITimeEntriesTabMetaData,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    if (week) {
      blocks.push(
        ...TimesheetTableView.getBlocks(week),
        ...this.getOpenBeforeBlocks(openBefore),
        ...this.getWeekButtons(week),
      );
    }

    blocks.push(...this.getFiltersBlocks(canFilterByUser, !week, filters));

    // Grouped by day: a day's line comes before its first entry.
    let day: string | undefined;

    const listBlocks = PaginatedListView.getBlocks<ITimeEntryListItem>({
      itemsData: {
        ...timeEntriesListData,
        page: page || 1,
        pageSize: TIME_ENTRIES_TAB_PAGE_SIZE,
      },
      getItemBlocks: (item) => {
        const dayBlocks =
          item.work_date === day
            ? []
            : this.getDayBlocks(item.work_date, dayTotals[item.work_date]);

        day = item.work_date;

        return [
          ...dayBlocks,
          ...this.getTimeEntryListItemBlocks(
            item,
            viewerId,
            userRole,
            canFilterByUser,
            billedIds.has(item.id),
          ),
        ];
      },
      prevPageActionId: TimeEntriesTabViewActionId.PaginationPrev,
      nextPageActionId: TimeEntriesTabViewActionId.PaginationNext,
      emptyText: '_No time entries found_',
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  // Drafts and rejected entries of earlier weeks, which the shown week hides:
  // the rejection DM and the Monday reminder send people to fix them. The
  // button goes to the oldest week that holds one.
  private getOpenBeforeBlocks(
    openBefore?: ITimesheetOpenBefore | null,
  ): AnyBlock[] {
    if (!openBefore) {
      return [];
    }

    return [
      {
        type: 'section',
        text: {
          type: 'plain_text',
          text: `📝 ${pluralize('open entry', openBefore.count, true)} in earlier weeks`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Go to week of ${weekLabel(openBefore.weekStart)}`,
          },
          action_id: TimeEntriesTabViewActionId.EarlierOpenWeek,
          value: openBefore.weekStart,
        },
      },
    ];
  }

  // The week's navigation, its form and its submit button (the drafts and
  // rejected entries of the shown week).
  private getWeekButtons(week: ITimesheetWeek): AnyBlock[] {
    const toSubmit =
      week.statusCounts[TimeEntryStatus.Draft] +
      week.statusCounts[TimeEntryStatus.Rejected];
    const elements = [
      {
        type: 'button',
        text: { type: 'plain_text', text: '⬅️ Previous week' },
        action_id: TimeEntriesTabViewActionId.PreviousWeek,
        value: shiftWeek(week.weekStart, -1),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Next week ➡️' },
        action_id: TimeEntriesTabViewActionId.NextWeek,
        value: shiftWeek(week.weekStart, 1),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Fill in the week' },
        action_id: TimeEntriesTabViewActionId.FillWeek,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Fill in today' },
        action_id: TimeEntriesTabViewActionId.FillDay,
      },
      ...(toSubmit > 0
        ? [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: `📤 Submit week (${toSubmit})`,
              },
              style: 'primary',
              action_id: TimeEntriesTabViewActionId.SubmitWeek,
            },
          ]
        : []),
    ];

    return splitIntoRows(elements).map((row) => ({
      type: 'actions',
      elements: row,
    })) as AnyBlock[];
  }

  private getDayBlocks(workDate: string, minutes = 0): AnyBlock[] {
    return [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*${formatDay(workDate)}* · ${getDisplayTime(minutes)}`,
          },
        ],
      },
    ];
  }

  // On the viewer's own list the project leads; on everyone's, the person.
  private getTimeEntryListItemBlocks(
    entry: ITimeEntryListItem,
    viewerId: string,
    userRole: UserRole,
    showsEveryone: boolean,
    isBilled: boolean,
  ): AnyBlock[] {
    const menuOptions = this.getMenuOptions(
      entry,
      viewerId,
      userRole,
      isBilled,
    );
    const project = [
      entry.project_name && `Project: ${escapeMrkdwn(entry.project_name)}`,
      entry.client_name && `Client: ${escapeMrkdwn(entry.client_name)}`,
    ]
      .filter(Boolean)
      .join(' · ');

    return ListItem.getBlocks({
      title: showsEveryone
        ? entry.user_name
        : entry.project_name || 'No project',
      details: [
        showsEveryone
          ? project
          : entry.client_name && `Client: ${escapeMrkdwn(entry.client_name)}`,
        `Time: ${getDisplayTime(entry.minutes)} · Status: ${withIcon(TIME_ENTRY_STATUS_LABELS[entry.status])}`,
        entry.description &&
          `Description: ${escapeMrkdwn(truncate(entry.description, { length: 80 }))}`,
        isBilled && 'Billing: 🔒 In a billing snapshot',
        entry.status === TimeEntryStatus.Rejected &&
          entry.rejection_reason &&
          `Reason: ${escapeMrkdwn(truncate(entry.rejection_reason.replace(/\s+/g, ' '), { length: 120 }))}`,
      ],
      accessory: menuOptions.length
        ? {
            type: 'overflow',
            action_id: TimeEntriesTabViewActionId.ManageTimeEntryMenu,
            options: menuOptions,
          }
        : undefined,
    });
  }

  // The owner changes and submits only drafts and rejected entries; Admin and
  // HR change any entry but one in a billing snapshot.
  private getMenuOptions(
    entry: ITimeEntryListItem,
    viewerId: string,
    userRole: UserRole,
    isBilled: boolean,
  ) {
    const isOpen = isOpenTimeEntry(entry.status);
    const canChange = !isBilled && (isOpen || isTimeEntriesAdmin(userRole));
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

  // My time shows a week, which its buttons choose: no From and To.
  private getFiltersBlocks(
    canFilterByUser: boolean,
    withDates: boolean,
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
      ...(withDates
        ? [
            {
              type: 'datepicker',
              actionId: TimeEntriesTabViewActionId.FilterByFromDate,
              placeholder: 'From Date',
              initialValue: filters?.fromDate || undefined,
            } as const,
            {
              type: 'datepicker',
              actionId: TimeEntriesTabViewActionId.FilterByToDate,
              placeholder: 'To Date',
              initialValue: filters?.toDate || undefined,
            } as const,
          ]
        : []),
    ];

    return FiltersBlockBuilder.build({
      filtersConfigs: filtersConfig,
      separator: false,
      resetButtonActionId: TimeEntriesTabViewActionId.ResetFilters,
    });
  }
}
