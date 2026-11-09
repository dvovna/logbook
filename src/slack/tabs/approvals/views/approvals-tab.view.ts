import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { formatDate, formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock, Button } from '@slack/web-api';
import { truncate } from 'lodash';
import * as pluralize from 'pluralize';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { Divider } from '@modules/slack/common/views/components/separator';
import { ApprovalsTabActionId } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { getDisplayTime } from '@common/utils/time.utils';
import {
  ITimeEntryListData,
  ITimeEntryListItem,
} from 'src/time-entries/types/time-entries-list.types';
import { ISearchResult } from '@common/types/pagination.types';
import { IRequestWorkflowStepViewModel } from '@modules/request-workflows/types/request-workflow-step.interface';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';

interface IGetViewParams extends IBaseTabViewParams {
  // The viewer's open approval steps, oldest first.
  timeOff: ISearchResult<IRequestWorkflowStepViewModel>;
  pendingEntries: ITimeEntryListData;
}

export interface IApprovalsTabMetaData {
  // The page of time entries.
  page?: number;
}

export const TIME_APPROVALS_PAGE_SIZE = 10;
export const TIME_OFF_SHOWN = 10;

const button = (
  text: string,
  actionId: string,
  value?: string,
  style?: 'primary' | 'danger',
): Button => ({
  type: 'button',
  text: { type: 'plain_text', text },
  action_id: actionId,
  ...(value ? { value } : {}),
  ...(style ? { style } : {}),
});

// What waits for the viewer's decision: time off requests, then submitted
// time entries.
@Injectable()
export class ApprovalsTabView extends BaseTabView<
  IGetViewParams,
  IApprovalsTabMetaData
> {
  protected callbackId = ViewCallbackId.ApprovalsTabView;

  protected getTabTitle() {
    return `*${SCREENS[ScreenId.Approvals].title}*\nWhat waits for your decision.`;
  }

  protected getContentBlocks(
    params: IGetViewParams,
    { page }: IApprovalsTabMetaData,
  ): AnyBlock[] {
    return [
      ...this.getTimeOffBlocks(params),
      ...this.getTimeEntriesBlocks(params, page),
    ];
  }

  private getTimeOffBlocks({ timeOff, userRole }: IGetViewParams): AnyBlock[] {
    const { items, totalCount } = timeOff;
    const more =
      totalCount > items.length ? ` · ${items.length} of ${totalCount}` : '';

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🌴 Time off* (${totalCount})${more}`,
        },
        // HR and admins may decide for approvers who are away.
        ...(ADMIN_AND_HR_ROLES.includes(userRole)
          ? {
              accessory: button(
                'All pending requests',
                ApprovalsTabActionId.AllPendingTimeOff,
              ),
            }
          : {}),
      },
      ...(items.length
        ? items.flatMap((step) => this.getTimeOffItemBlocks(step))
        : [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: '_No time off requests wait for you._',
                },
              ],
            } as AnyBlock,
          ]),
      ...(totalCount > items.length
        ? [
            {
              type: 'actions',
              elements: [
                button('📋 All requests', NavigationActionId.AllRequests),
              ],
            } as AnyBlock,
          ]
        : []),
    ];
  }

  private getTimeOffItemBlocks(step: IRequestWorkflowStepViewModel) {
    // The snapshot of the request: its requester, not the approver.
    const request = step.step_data.snapshot;

    return ListItem.getBlocks({
      title: request.user_name || request.user_email,
      details: [
        `${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]} · ${formatDateRange(request.start_date, request.end_date)} (${pluralize('day', request.days, true)})`,
      ],
      accessory: {
        type: 'overflow',
        action_id: ApprovalsTabActionId.TimeOffMenu,
        options: [
          {
            text: { type: 'plain_text', text: 'Comment' },
            value: `${ApprovalsTabActionId.CommentTimeOff}:${step.id}`,
          },
          {
            text: { type: 'plain_text', text: 'View details' },
            value: `${ApprovalsTabActionId.TimeOffDetails}:${step.request_id}`,
          },
        ],
      },
      buttons: [
        button('Approve', ApprovalsTabActionId.ApproveTimeOff, step.id),
        button('Reject', ApprovalsTabActionId.RejectTimeOff, step.id, 'danger'),
      ],
    });
  }

  private getTimeEntriesBlocks(
    { pendingEntries }: IGetViewParams,
    page?: number,
  ): AnyBlock[] {
    const { totalCount } = pendingEntries;

    return [
      ...Divider.getBlocks(),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*⏱ Time entries* (${totalCount})` },
        ...(totalCount
          ? {
              accessory: button(
                `Approve all (${totalCount})`,
                ApprovalsTabActionId.ApproveAll,
                undefined,
                'primary',
              ),
            }
          : {}),
      },
      ...PaginatedListView.getBlocks<ITimeEntryListItem>({
        itemsData: {
          ...pendingEntries,
          page: page || 1,
          pageSize: TIME_APPROVALS_PAGE_SIZE,
        },
        getItemBlocks: (entry) => this.getEntryBlocks(entry),
        prevPageActionId: ApprovalsTabActionId.PaginationPrev,
        nextPageActionId: ApprovalsTabActionId.PaginationNext,
        emptyText: '_No time entries wait for you._',
      }),
    ];
  }

  private getEntryBlocks(entry: ITimeEntryListItem): AnyBlock[] {
    return ListItem.getBlocks({
      title: entry.user_name,
      details: [
        [
          entry.project_name && `Project: ${escapeMrkdwn(entry.project_name)}`,
          entry.client_name && `Client: ${escapeMrkdwn(entry.client_name)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        `Date: ${formatDate(entry.work_date)} · Time: ${getDisplayTime(entry.minutes)}`,
        entry.description &&
          `Description: ${escapeMrkdwn(truncate(entry.description, { length: 80 }))}`,
      ],
      buttons: [
        button('Approve', ApprovalsTabActionId.ApproveEntry, entry.id),
        button('Reject', ApprovalsTabActionId.RejectEntry, entry.id, 'danger'),
      ],
    });
  }
}
