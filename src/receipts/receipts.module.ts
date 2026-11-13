import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import { PostgresReceiptFileStore } from '@modules/receipts/services/postgres-receipt-file.store';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { ReceiptsHomeService } from '@modules/receipts/services/receipts-home.service';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

@Module({
  imports: [SlackTeamsModule],
  providers: [
    ReceiptsRepository,
    ReimbursementsRepository,
    ReimbursementsService,
    { provide: ReceiptFileStore, useClass: PostgresReceiptFileStore },
    ReceiptsService,
    ReceiptsHomeService,
  ],
  exports: [
    ReceiptsService,
    ReceiptsHomeService,
    ReimbursementsService,
    ReceiptFileStore,
  ],
})
export class ReceiptsModule {}
