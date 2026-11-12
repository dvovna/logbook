import { Module } from '@nestjs/common';
import { ClientsModule } from '@modules/clients/clients.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { BillingSnapshotExportService } from 'src/billing/services/billing-snapshot-export.service';
import { UninvoicedReportService } from 'src/billing/services/uninvoiced-report.service';

// Billing snapshots and what hasn't been invoiced yet. The lock on the
// entries of a snapshot is the time entries' own (TimeEntriesValidationService
// and the trigger), so this module needs nothing from them.
@Module({
  imports: [ClientsModule, SlackTeamsModule],
  providers: [
    BillingSnapshotsRepository,
    BillingSnapshotEntriesRepository,
    BillingSnapshotsService,
    BillingSnapshotExportService,
    UninvoicedReportService,
  ],
  exports: [
    BillingSnapshotsService,
    BillingSnapshotExportService,
    UninvoicedReportService,
  ],
})
export class BillingModule {}
