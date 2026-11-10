import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import { formatDate } from '@common/utils/date.utils';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BillingSnapshotsModalName } from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';
import {
  BillingSnapshotsTabView,
  IBillingSnapshotsTabMetadata,
  snapshotAmount,
  snapshotName,
} from '@modules/slack/tabs/billing-snapshots/views/billing-snapshots-tab.view';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import ClientsService from '@modules/clients/services/clients.service';

export interface ISnapshotModalParams extends IOpenModalBaseParams<string> {
  snapshotId: string;
}

type BillingSnapshotsModalResolversMap = {
  [key in BillingSnapshotsModalName]: (
    params: ISnapshotModalParams,
  ) => Promise<View>;
};

const PAGE_SIZE = 10;

// The forms' callbacks and titles.
const MODALS = {
  [BillingSnapshotsModalName.MarkInvoiced]: {
    callbackId: ViewCallbackId.MarkBillingSnapshotInvoiced,
    title: 'Mark as invoiced',
  },
  [BillingSnapshotsModalName.MarkNotInvoiced]: {
    callbackId: ViewCallbackId.MarkBillingSnapshotNotInvoiced,
    title: 'Mark as not invoiced',
  },
  [BillingSnapshotsModalName.Unlock]: {
    callbackId: ViewCallbackId.UnlockBillingSnapshot,
    title: 'Unlock snapshot',
  },
};

@Injectable()
export class BillingSnapshotsTabService extends BaseTabService<
  BillingSnapshotsModalResolversMap,
  IPublishBaseParams<IBillingSnapshotsTabMetadata>
> {
  public constructor(
    private readonly billingSnapshotsTabView: BillingSnapshotsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly billingSnapshotsService: BillingSnapshotsService,
    private readonly clientsService: ClientsService,
  ) {
    super(TabId.BillingSnapshots, {
      [BillingSnapshotsModalName.MarkInvoiced]: (params) =>
        this.getMarkInvoicedModal(params),
      [BillingSnapshotsModalName.MarkNotInvoiced]: (params) =>
        this.getMarkNotInvoicedModal(params),
      [BillingSnapshotsModalName.Unlock]: (params) =>
        this.getUnlockModal(params),
    });
  }

  protected async getTabView({
    user,
    metadata = {},
  }: IPublishBaseParams<IBillingSnapshotsTabMetadata>) {
    const [snapshots, clients] = await Promise.all([
      this.billingSnapshotsService.search(user, {
        page: metadata.page,
        pageSize: PAGE_SIZE,
        clientId: metadata.filters?.clientId,
      }),
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
    ]);

    return this.billingSnapshotsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        snapshots,
        clients: clients
          .map(({ id, name }) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
      metadata,
    );
  }

  // The form again with the error; when the snapshot is gone, only the
  // error.
  public async getErrorModal(
    modalName: BillingSnapshotsModalName,
    params: ISnapshotModalParams,
  ): Promise<View> {
    try {
      return await this.getModalView(modalName, params);
    } catch {
      const { callbackId, title } = MODALS[modalName];

      return this.confirmationModalView.getView(
        { callbackId, title, message: `:warning: ${params.errorMessage}` },
        { id: params.snapshotId, pageMetadata: params.pageMetadata },
      );
    }
  }

  private async getMarkInvoicedModal({
    user,
    snapshotId,
    errorMessage,
    pageMetadata,
  }: ISnapshotModalParams) {
    const snapshot = await this.billingSnapshotsService.findOne(
      snapshotId,
      user,
    );

    return this.confirmationModalView.getView(
      {
        ...MODALS[BillingSnapshotsModalName.MarkInvoiced],
        confirmText: 'Mark invoiced',
        message: `The snapshot *${escapeMrkdwn(snapshotName(snapshot))}* (*${snapshotAmount(snapshot)}*) will be marked invoiced. It stays locked.`,
        errorMessage,
      },
      { id: snapshot.id, pageMetadata },
    );
  }

  private async getMarkNotInvoicedModal({
    user,
    snapshotId,
    errorMessage,
    pageMetadata,
  }: ISnapshotModalParams) {
    const snapshot = await this.billingSnapshotsService.findOne(
      snapshotId,
      user,
    );

    return this.confirmationModalView.getView(
      {
        ...MODALS[BillingSnapshotsModalName.MarkNotInvoiced],
        confirmText: 'Mark not invoiced',
        message: `The snapshot *${escapeMrkdwn(snapshotName(snapshot))}* will no longer be marked invoiced. It stays locked, and its time counts as uninvoiced again.`,
        errorMessage,
      },
      { id: snapshot.id, pageMetadata },
    );
  }

  // An invoiced snapshot can be unlocked too, so that a mistake can be put
  // right; the form says the invoice was sent.
  private async getUnlockModal({
    user,
    snapshotId,
    errorMessage,
    pageMetadata,
  }: ISnapshotModalParams) {
    const snapshot = await this.billingSnapshotsService.findOne(
      snapshotId,
      user,
    );
    const entries = `${snapshot.entryCount} ${snapshot.entryCount === 1 ? 'entry' : 'entries'}`;

    return this.confirmationModalView.getView(
      {
        ...MODALS[BillingSnapshotsModalName.Unlock],
        confirmText: 'Unlock',
        message: [
          `The snapshot *${escapeMrkdwn(snapshotName(snapshot))}* will be deleted. Its ${entries} can be changed again, and count as uninvoiced until another snapshot takes them.`,
          snapshot.invoiced_at &&
            `⚠️ It was marked invoiced on ${formatDate(snapshot.invoiced_at)}. If its time changes, it won't match the invoice.`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        errorMessage,
      },
      { id: snapshot.id, pageMetadata },
    );
  }
}
