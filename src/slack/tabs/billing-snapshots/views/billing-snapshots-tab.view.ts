import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import UserRole from '@common/enums/user-role.enum';
import { ISearchResult } from '@common/types/pagination.types';
import { formatDate, formatDateRange } from '@common/utils/date.utils';
import { formatMoney } from '@common/utils/money.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { BillingSnapshotsTabActionId } from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';
import { IBillingSnapshot } from 'src/billing/types/billing-snapshot.types';
import { IOption } from '@common/types/option.interface';
import { ALL_OPTION_VALUE } from '@modules/slack/common/views/data/all-option-value';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

export interface IBillingSnapshotsTabMetadata {
  page?: number;
  // The client the list shows the snapshots of (withSelectFilter).
  filters?: { clientId?: string };
}

// The list's page and filter, as a form opened from it carries them
// (pageMetadata).
export const parsePageMetadata = (
  pageMetadata?: string,
): IBillingSnapshotsTabMetadata => {
  try {
    const { page, filters } = JSON.parse(pageMetadata || '{}');

    return {
      ...(typeof page === 'number' ? { page } : {}),
      ...(typeof filters?.clientId === 'string'
        ? { filters: { clientId: filters.clientId } }
        : {}),
    };
  } catch {
    return {};
  }
};

interface IGetViewParams extends IBaseTabViewParams {
  snapshots: ISearchResult<IBillingSnapshot>;
  // The clients to filter by.
  clients: IOption[];
}

// A static select holds 100 options, one of them "All clients".
const MAX_CLIENTS = 99;

const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '0h');

// "Acme · 1–31 Oct 2026": what a snapshot is called in lists, forms and
// messages (plain text).
export const snapshotName = (snapshot: IBillingSnapshot) =>
  `${snapshot.client?.name ?? 'Unknown client'} · ${formatDateRange(snapshot.period_start, snapshot.period_end)}`;

export const snapshotAmount = (snapshot: IBillingSnapshot) =>
  formatMoney(snapshot.total_amount_cents, snapshot.currency);

const byWhom = (person: { name: string } | null) =>
  person ? ` by ${escapeMrkdwn(person.name)}` : '';

// The workspace's billing snapshots, newest first, for Admin and HR: what
// each holds and whether it is invoiced, with its CSV, the invoiced mark,
// and (an admin's) unlocking.
@Injectable()
export class BillingSnapshotsTabView extends BaseTabView<
  IGetViewParams,
  IBillingSnapshotsTabMetadata
> {
  protected callbackId = ViewCallbackId.BillingSnapshotsTabView;

  public constructor(
    private readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected getTabTitle(): string {
    return `*${SCREENS[ScreenId.BillingSnapshots].title}*\nA client's approved time of a period, locked with its rates for an invoice. Nobody can change a snapshot's entries until an admin unlocks it.`;
  }

  protected getContentBlocks(
    { snapshots, clients, userRole }: IGetViewParams,
    { filters }: IBillingSnapshotsTabMetadata,
  ): AnyBlock[] {
    return [
      ...this.getFilterBlocks(clients, filters?.clientId),
      ...this.getListBlocks(snapshots, userRole),
    ];
  }

  private getFilterBlocks(clients: IOption[], clientId?: string): AnyBlock[] {
    if (!clients.length) {
      return [];
    }

    const options = [
      { id: ALL_OPTION_VALUE, name: 'All clients' },
      ...clients.slice(0, MAX_CLIENTS),
    ].map(toPlainTextOption);

    return [
      {
        type: 'actions',
        elements: [
          {
            type: 'static_select',
            action_id: BillingSnapshotsTabActionId.FilterByClient,
            placeholder: { type: 'plain_text', text: 'Client' },
            options,
            initial_option:
              options.find(({ value }) => value === clientId) ?? options[0],
          },
        ],
      } as AnyBlock,
    ];
  }

  private getListBlocks(
    snapshots: ISearchResult<IBillingSnapshot>,
    userRole: UserRole,
  ): AnyBlock[] {
    return PaginatedListView.getBlocks<IBillingSnapshot>({
      itemsData: snapshots,
      getItemBlocks: (snapshot) => this.getItemBlocks(snapshot, userRole),
      prevPageActionId: BillingSnapshotsTabActionId.PaginationPrev,
      nextPageActionId: BillingSnapshotsTabActionId.PaginationNext,
      emptyText:
        "_No snapshots yet._ Show a client's billing report on Reports, then lock its approved time in a snapshot.",
    });
  }

  private getItemBlocks(
    snapshot: IBillingSnapshot,
    userRole: UserRole,
  ): AnyBlock[] {
    const option = (id: BillingSnapshotsTabActionId, text: string) => ({
      text: { type: 'plain_text' as const, text },
      value: `${id}:${snapshot.id}`,
    });
    const options = [
      option(BillingSnapshotsTabActionId.ExportSnapshot, 'Send CSV to my DMs'),
      snapshot.invoiced_at
        ? option(
            BillingSnapshotsTabActionId.MarkNotInvoiced,
            'Mark as not invoiced',
          )
        : option(BillingSnapshotsTabActionId.MarkInvoiced, 'Mark as invoiced'),
      ...(this.slackActionPermissionsService.can(
        userRole,
        BillingSnapshotsTabActionId.UnlockSnapshot,
      )
        ? [option(BillingSnapshotsTabActionId.UnlockSnapshot, 'Unlock')]
        : []),
    ];

    return ListItem.getBlocks({
      title: snapshotName(snapshot),
      details: [
        `Time: ${hours(snapshot.total_minutes)} · Billable: ${hours(snapshot.billable_minutes)} · Amount: ${snapshotAmount(snapshot)}`,
        snapshot.unratedMinutes > 0 &&
          `No rate: ${hours(snapshot.unratedMinutes)} of billable time, not in the amount`,
        `Entries: ${snapshot.entryCount}`,
        snapshot.invoiced_at
          ? `Status: ✅ Invoiced ${formatDate(snapshot.invoiced_at)}${byWhom(snapshot.invoicer)}`
          : 'Status: 🔒 Locked, not invoiced yet',
        `Created: ${formatDate(snapshot.created_at)}${byWhom(snapshot.creator)}`,
      ],
      accessory: {
        type: 'overflow',
        action_id: BillingSnapshotsTabActionId.ManageSnapshotMenu,
        options,
      },
    });
  }
}
