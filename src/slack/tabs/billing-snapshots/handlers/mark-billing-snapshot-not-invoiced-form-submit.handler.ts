import { Injectable } from '@nestjs/common';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { IConfirmationModalViewMetadata } from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { BillingSnapshotsModalName } from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';
import { BillingSnapshotsTabService } from '@modules/slack/tabs/billing-snapshots/services/billing-snapshots-tab.service';
import {
  parsePageMetadata,
  snapshotName,
} from '@modules/slack/tabs/billing-snapshots/views/billing-snapshots-tab.view';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { SNAPSHOT_ROLES } from 'src/billing/constants/snapshot-roles';
import { IBillingSnapshot } from 'src/billing/types/billing-snapshot.types';

// Takes the invoiced mark off a snapshot, e.g. one set by mistake.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.MarkBillingSnapshotNotInvoiced,
  type: 'view_submission',
  allowedRoles: SNAPSHOT_ROLES,
})
export class MarkBillingSnapshotNotInvoicedFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IBillingSnapshot
> {
  public constructor(
    private readonly billingSnapshotsService: BillingSnapshotsService,
    private readonly billingSnapshotsTabService: BillingSnapshotsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected async onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IBillingSnapshot> {
    const snapshot = await this.billingSnapshotsService.markNotInvoiced(
      meta.id,
      user,
    );

    this.tabNavigationService.navigate(TabId.BillingSnapshots, {
      user,
      metadata: parsePageMetadata(meta.pageMetadata),
      notice: `↩️ ${snapshotName(snapshot)} is no longer marked invoiced.`,
    });

    return snapshot;
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    return SlackViewResponseFactory.update(
      await this.billingSnapshotsTabService.getErrorModal(
        BillingSnapshotsModalName.MarkNotInvoiced,
        {
          user,
          snapshotId: meta.id,
          errorMessage,
          pageMetadata: meta.pageMetadata ?? '{}',
        },
      ),
    );
  }
}
