import { Injectable } from '@nestjs/common';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { formatDateRange } from '@common/utils/date.utils';
import { formatMoney } from '@common/utils/money.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ValidationError } from '@common/errors/validation.error';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  billingReportOf,
  ReportsTabService,
} from '@modules/slack/tabs/reports/services/reports-tab.service';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { SNAPSHOT_ROLES } from 'src/billing/constants/snapshot-roles';
import { IBillingSnapshot } from 'src/billing/types/billing-snapshot.types';

// Locks the approved time of the billing report on show (the client and the
// period in the form's metadata, which the service checks) in a snapshot,
// then shows Billing snapshots.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CreateBillingSnapshot,
  type: 'view_submission',
  allowedRoles: SNAPSHOT_ROLES,
})
export class CreateBillingSnapshotFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IBillingSnapshot
> {
  public constructor(
    private readonly billingSnapshotsService: BillingSnapshotsService,
    private readonly reportsTabService: ReportsTabService,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected async onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IBillingSnapshot> {
    const report = billingReportOf(meta.pageMetadata);

    if (!report) {
      throw new ValidationError('Show a billing report first.');
    }

    const snapshot = await this.billingSnapshotsService.create({
      user,
      ...report,
    });

    this.tabNavigationService.navigate(TabId.BillingSnapshots, {
      user,
      notice: `🔒 ${snapshot.client?.name ?? 'Snapshot'} · ${formatDateRange(snapshot.period_start, snapshot.period_end)} locked: ${snapshot.entryCount} ${snapshot.entryCount === 1 ? 'entry' : 'entries'}, ${getDisplayTime(snapshot.total_minutes)}, ${formatMoney(snapshot.total_amount_cents, snapshot.currency)}.`,
    });

    return snapshot;
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  // The form again with the error; when it can't be made (the client is
  // gone), only the error.
  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const view = await Promise.resolve(
      this.reportsTabService.getModalView(ReportsModalName.LockSnapshot, {
        user,
        errorMessage,
        pageMetadata: meta.pageMetadata ?? '{}',
      }),
    ).catch(() =>
      this.confirmationModalView.getView(
        {
          callbackId: ViewCallbackId.CreateBillingSnapshot,
          title: 'Lock in a snapshot',
          message: `:warning: ${errorMessage}`,
        },
        meta,
      ),
    );

    return SlackViewResponseFactory.update(view);
  }
}
