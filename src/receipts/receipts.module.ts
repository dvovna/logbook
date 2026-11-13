import { Module } from '@nestjs/common';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import { PostgresReceiptFileStore } from '@modules/receipts/services/postgres-receipt-file.store';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

@Module({
  providers: [
    ReceiptsRepository,
    ReimbursementsRepository,
    ReimbursementsService,
    { provide: ReceiptFileStore, useClass: PostgresReceiptFileStore },
    ReceiptsService,
  ],
  exports: [ReceiptsService, ReimbursementsService, ReceiptFileStore],
})
export class ReceiptsModule {}
