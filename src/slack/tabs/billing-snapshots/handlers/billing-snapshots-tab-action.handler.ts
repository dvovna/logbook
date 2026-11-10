import { Injectable, Logger } from '@nestjs/common';
import { runInBackground } from '@common/utils/run-in-background';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  withPagination,
  withSelectFilter,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import {
  BillingSnapshotsModalName,
  BillingSnapshotsTabActionId,
} from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';
import { BillingSnapshotsTabService } from '@modules/slack/tabs/billing-snapshots/services/billing-snapshots-tab.service';
import { BillingSnapshotDmService } from '@modules/slack/tabs/billing-snapshots/services/billing-snapshot-dm.service';
import { IBillingSnapshotsTabMetadata } from '@modules/slack/tabs/billing-snapshots/views/billing-snapshots-tab.view';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { assertCanUnlockSnapshots } from 'src/billing/constants/snapshot-roles';

// The snapshot ID comes from the menu, so from the client: the services
// check that it is the workspace's, and the role.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.BillingSnapshotsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.BillingSnapshots),
})
export default class BillingSnapshotsTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;
  private readonly logger = new Logger(BillingSnapshotsTabActionHandler.name);

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly billingSnapshotsTabService: BillingSnapshotsTabService,
    private readonly billingSnapshotsService: BillingSnapshotsService,
    private readonly billingSnapshotDmService: BillingSnapshotDmService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [BillingSnapshotsTabActionId.ManageSnapshotMenu]: withMenuAction<
        BillingSnapshotsTabActionId,
        [IUserViewModel]
      >(this.handleMenuAction, this.logger),
      [BillingSnapshotsTabActionId.FilterByClient]:
        withSelectFilter<IBillingSnapshotsTabMetadata>(
          'clientId',
          this.updateTab,
        ),
      [BillingSnapshotsTabActionId.PaginationPrev]: paginationHandler,
      [BillingSnapshotsTabActionId.PaginationNext]: paginationHandler,
    };
  }

  private updateTab = async (
    metadata: IBillingSnapshotsTabMetadata,
    user: IUserViewModel,
  ) => {
    await this.billingSnapshotsTabService.publish({ user, metadata });
  };

  private handleMenuAction = async (
    actionType: BillingSnapshotsTabActionId,
    snapshotId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case BillingSnapshotsTabActionId.ExportSnapshot:
        return this.handleExport(snapshotId, payload, user);
      case BillingSnapshotsTabActionId.MarkInvoiced:
        return this.openModal(
          BillingSnapshotsModalName.MarkInvoiced,
          snapshotId,
          payload,
          user,
        );
      case BillingSnapshotsTabActionId.MarkNotInvoiced:
        return this.openModal(
          BillingSnapshotsModalName.MarkNotInvoiced,
          snapshotId,
          payload,
          user,
        );
      case BillingSnapshotsTabActionId.UnlockSnapshot:
        assertCanUnlockSnapshots(user);

        return this.openModal(
          BillingSnapshotsModalName.Unlock,
          snapshotId,
          payload,
          user,
        );
      default:
        this.logger.warn(
          `Unhandled billing snapshot menu action: ${actionType}`,
        );
    }
  };

  private async openModal(
    modalName: BillingSnapshotsModalName,
    snapshotId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    await this.billingSnapshotsTabService.openModal(
      payload.trigger_id || user.slack_id,
      modalName,
      { user, snapshotId, pageMetadata: payload.view.private_metadata },
    );
  }

  // The upload takes longer than Slack waits for an answer, so it runs after
  // it; the snapshot is looked up first, so that a wrong one fails here.
  private async handleExport(
    snapshotId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    await this.billingSnapshotsService.findOne(snapshotId, user);

    runInBackground(this.logger, 'send a billing snapshot as CSV', () =>
      this.billingSnapshotDmService.send(user, snapshotId),
    );

    this.tabNavigationService.navigate(TabId.BillingSnapshots, {
      user,
      metadata: parseMetadata<IBillingSnapshotsTabMetadata>(payload),
      notice: '📨 Sending the CSV to your DMs.',
    });
  }
}
