import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { truncate } from 'lodash';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { BackButton } from '@modules/slack/common/views/components/back-button';
import { Divider } from '@modules/slack/common/views/components/separator';
import { TimeApprovalsTabActionId } from '@modules/slack/tabs/time-approvals/enums/time-approvals-tab-action-id.enum';
import { getDisplayTime } from '@common/utils/time.utils';
import {
  ITimeEntryListData,
  ITimeEntryListItem,
} from 'src/time-entries/types/time-entries-list.types';

interface IGetViewParams extends IBaseTabViewParams {
  pendingEntries: ITimeEntryListData;
}

export interface ITimeApprovalsTabMetaData {
  page?: number;
}

export const TIME_APPROVALS_PAGE_SIZE = 5;

// The submitted time entries the viewer decides on.
@Injectable()
export class TimeApprovalsTabView extends BaseAdminTabView<
  IGetViewParams,
  ITimeApprovalsTabMetaData
> {
  protected callbackId = ViewCallbackId.TimeApprovalsTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageTimeAndBilling;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '✅ *Time Approvals*\n\nSubmitted time entries waiting for your decision.';
  }

  protected getTitleAccessory({
    pendingEntries,
  }: IGetViewParams): SectionBlockAccessory | null {
    if (!pendingEntries.totalCount) {
      return null;
    }

    return {
      type: 'button',
      text: {
        type: 'plain_text',
        text: `Approve all (${pendingEntries.totalCount})`,
      },
      style: 'primary',
      action_id: TimeApprovalsTabActionId.ApproveAll,
    };
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManageTimeAndBilling);
  }

  protected getContentBlocks(
    { pendingEntries }: IGetViewParams,
    { page }: ITimeApprovalsTabMetaData,
  ): AnyBlock[] {
    return PaginatedListView.getBlocks<ITimeEntryListItem>({
      itemsData: {
        ...pendingEntries,
        page: page || 1,
        pageSize: TIME_APPROVALS_PAGE_SIZE,
      },
      getItemBlocks: (entry) => this.getEntryBlocks(entry),
      prevPageActionId: TimeApprovalsTabActionId.PaginationPrev,
      nextPageActionId: TimeApprovalsTabActionId.PaginationNext,
      emptyText: '_Nothing is waiting for your approval._',
    });
  }

  private getEntryBlocks(entry: ITimeEntryListItem): AnyBlock[] {
    const workDate = new Date(entry.work_date).toLocaleDateString();

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
              `Description: ${truncate(entry.description || '-', { length: 80 })}`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: TimeApprovalsTabActionId.ApproveEntry,
            value: entry.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: TimeApprovalsTabActionId.RejectEntry,
            value: entry.id,
          },
        ],
      },
      ...Divider.getBlocks(),
    ];
  }
}
