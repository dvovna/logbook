import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementOptOutsRepository } from '@modules/receipts/repositories/reimbursement-opt-outs.repository';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import { PostgresReceiptFileStore } from '@modules/receipts/services/postgres-receipt-file.store';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { ReceiptDecisionsService } from '@modules/receipts/services/receipt-decisions.service';
import { ReceiptsHomeService } from '@modules/receipts/services/receipts-home.service';
import { ReceiptsMonthService } from '@modules/receipts/services/receipts-month.service';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

@Module({
  imports: [SlackTeamsModule, UsersModule, TeamsModule],
  providers: [
    ReceiptsRepository,
    ReimbursementsRepository,
    ReimbursementOptOutsRepository,
    ReimbursementsService,
    { provide: ReceiptFileStore, useClass: PostgresReceiptFileStore },
    ReceiptsService,
    ReceiptsHomeService,
    ReceiptDecisionsService,
    ReceiptsMonthService,
  ],
  exports: [
    ReceiptsService,
    ReceiptsHomeService,
    ReceiptDecisionsService,
    ReceiptsMonthService,
    ReimbursementsService,
    ReceiptFileStore,
  ],
})
export class ReceiptsModule {}
