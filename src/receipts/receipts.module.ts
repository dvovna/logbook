import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReimbursementOptOutsRepository } from '@modules/receipts/repositories/reimbursement-opt-outs.repository';
import { ReimbursementRemindersRepository } from '@modules/receipts/repositories/reimbursement-reminders.repository';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import {
  DEFAULT_RECEIPTS_ARCHIVE_LIMITS,
  RECEIPTS_ARCHIVE_LIMITS,
} from '@modules/receipts/constants/receipts-archive';
import { PostgresReceiptFileStore } from '@modules/receipts/services/postgres-receipt-file.store';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { ReceiptDecisionsService } from '@modules/receipts/services/receipt-decisions.service';
import { ReceiptsArchiveService } from '@modules/receipts/services/receipts-archive.service';
import { ReceiptsHomeService } from '@modules/receipts/services/receipts-home.service';
import { ReceiptsMonthService } from '@modules/receipts/services/receipts-month.service';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReimbursementOptOutsService } from '@modules/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

@Module({
  imports: [SlackTeamsModule, UsersModule, TeamsModule],
  providers: [
    ReceiptsRepository,
    ReimbursementsRepository,
    ReimbursementOptOutsRepository,
    ReimbursementRemindersRepository,
    ReimbursementsService,
    ReimbursementOptOutsService,
    { provide: ReceiptFileStore, useClass: PostgresReceiptFileStore },
    ReceiptsService,
    ReceiptsHomeService,
    ReceiptDecisionsService,
    ReceiptsMonthService,
    ReceiptsArchiveService,
    {
      provide: RECEIPTS_ARCHIVE_LIMITS,
      useValue: { ...DEFAULT_RECEIPTS_ARCHIVE_LIMITS },
    },
  ],
  exports: [
    ReceiptsService,
    ReceiptsHomeService,
    ReceiptDecisionsService,
    ReceiptsMonthService,
    ReceiptsArchiveService,
    ReimbursementsService,
    ReimbursementOptOutsService,
    ReimbursementRemindersRepository,
    ReceiptFileStore,
  ],
})
export class ReceiptsModule {}
