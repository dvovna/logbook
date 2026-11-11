import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { BillingModule } from 'src/billing/billing.module';
import BillingSnapshotsTabActionHandler from '@modules/slack/tabs/billing-snapshots/handlers/billing-snapshots-tab-action.handler';
import { MarkBillingSnapshotInvoicedFormSubmitHandler } from '@modules/slack/tabs/billing-snapshots/handlers/mark-billing-snapshot-invoiced-form-submit.handler';
import { MarkBillingSnapshotNotInvoicedFormSubmitHandler } from '@modules/slack/tabs/billing-snapshots/handlers/mark-billing-snapshot-not-invoiced-form-submit.handler';
import { ClientsModule } from '@modules/clients/clients.module';
import { UnlockBillingSnapshotFormSubmitHandler } from '@modules/slack/tabs/billing-snapshots/handlers/unlock-billing-snapshot-form-submit.handler';
import { BillingSnapshotsTabService } from '@modules/slack/tabs/billing-snapshots/services/billing-snapshots-tab.service';
import { BillingSnapshotDmService } from '@modules/slack/tabs/billing-snapshots/services/billing-snapshot-dm.service';
import { BillingSnapshotsTabView } from '@modules/slack/tabs/billing-snapshots/views/billing-snapshots-tab.view';
import { UsersModule } from '@modules/users/users.module';

// Billing snapshots (Reports → Billing snapshots): the list, each one's CSV,
// the invoiced mark and unlocking. Snapshots are made on Reports, from a
// billing report.
@Module({
  imports: [SlackCommonModule, BillingModule, ClientsModule, UsersModule],
  providers: [
    BillingSnapshotsTabActionHandler,
    MarkBillingSnapshotInvoicedFormSubmitHandler,
    MarkBillingSnapshotNotInvoicedFormSubmitHandler,
    UnlockBillingSnapshotFormSubmitHandler,
    BillingSnapshotsTabService,
    BillingSnapshotDmService,
    BillingSnapshotsTabView,
  ],
})
export class BillingSnapshotsTabModule {}
