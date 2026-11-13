import { Module } from '@nestjs/common';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

@Module({
  providers: [ReimbursementsRepository, ReimbursementsService],
  exports: [ReimbursementsService],
})
export class ReceiptsModule {}
