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
import { runInBackground } from '@common/utils/run-in-background';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  billingReportOf,
  IReportsPublishParams,
  ReportsTabService,
} from '@modules/slack/tabs/reports/services/reports-tab.service';
import {
  BillingSnapshotsService,
  ISnapshotParams,
} from 'src/billing/services/billing-snapshots.service';
import { SNAPSHOT_ROLES } from 'src/billing/constants/snapshot-roles';

// Locks the approved time of the billing report on show (the client and the
// period in the form's metadata, which the service checks) in a snapshot.
// The quick checks run before the answer, so the form can show them; the
// snapshot is made after it, since a year of a big client's time can take
// longer than Slack waits, and Billing snapshots then shows it. It is not a
// job: the person waits for it on the tab, and a retry minutes later would
// lock time approved since, which they never saw. One transaction, so a
// failure leaves nothing half-made: Reports says so, and the time stays
// there to lock again.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CreateBillingSnapshot,
  type: 'view_submission',
  allowedRoles: SNAPSHOT_ROLES,
})
export class CreateBillingSnapshotFormSubmitHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  public constructor(
    private readonly billingSnapshotsService: BillingSnapshotsService,
    private readonly reportsTabService: ReportsTabService,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected async onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<void> {
    const report = billingReportOf(meta.pageMetadata);

    if (!report) {
      throw new ValidationError('Show a billing report first.');
    }

    const params = { user, ...report };

    await this.billingSnapshotsService.assertCanCreate(params);

    runInBackground(this.logger, 'lock a billing snapshot', () =>
      this.lock(params),
    );
  }

  // Shows the snapshot on Billing snapshots, or Reports again with why
  // nothing was locked.
  private async lock(params: ISnapshotParams) {
    const { user, clientId, fromDate, toDate } = params;

    try {
      const snapshot = await this.billingSnapshotsService.create(params);

      this.tabNavigationService.navigate(TabId.BillingSnapshots, {
        user,
        notice: `🔒 ${snapshot.client?.name ?? 'Snapshot'} · ${formatDateRange(snapshot.period_start, snapshot.period_end)} locked: ${snapshot.entryCount} ${snapshot.entryCount === 1 ? 'entry' : 'entries'}, ${getDisplayTime(snapshot.total_minutes)}, ${formatMoney(snapshot.total_amount_cents, snapshot.currency)}.`,
      });
    } catch (error) {
      const kind = classifyActionError(error);
      const unexpected = kind === 'unexpected' || kind === 'not-found';

      this.tabNavigationService.navigate<IReportsPublishParams>(TabId.Reports, {
        user,
        metadata: { report: { clientId, fromDate, toDate } },
        notice: `⚠️ Nothing was locked. ${unexpected ? 'Something went wrong; please try again.' : (error as Error).message}`,
      });

      if (unexpected) {
        throw error;
      }
    }
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  // The form again with the error; when it can't be made (the client is
  // gone), only the error.
  protected async errorResponse(
    errorMessage: string,
    _data: object,
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
