import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ReceiptsSlackModule } from '@modules/slack/receipts/receipts-slack.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { ArchiveReimbursementFormSubmitHandler } from '@modules/slack/tabs/receipts/handlers/archive-reimbursement-form-submit.handler';
import { ReceiptsTabActionHandler } from '@modules/slack/tabs/receipts/handlers/receipts-tab-action.handler';
import { RejectReceiptFormSubmitHandler } from '@modules/slack/tabs/receipts/handlers/reject-receipt-form-submit.handler';
import { ReimbursementFormSubmitHandler } from '@modules/slack/tabs/receipts/handlers/reimbursement-form-submit.handler';
import { RejectReceiptParser } from '@modules/slack/tabs/receipts/parsers/reject-receipt.parser';
import { ReimbursementModalParser } from '@modules/slack/tabs/receipts/parsers/reimbursement-modal.parser';
import { ReceiptsTabService } from '@modules/slack/tabs/receipts/services/receipts-tab.service';
import { ReceiptsTabView } from '@modules/slack/tabs/receipts/views/receipts-tab.view';
import { ReimbursementModalView } from '@modules/slack/tabs/receipts/views/reimbursement-modal.view';
import { ReimbursementsView } from '@modules/slack/tabs/receipts/views/reimbursements.view';
import { RejectReceiptModalView } from '@modules/slack/tabs/receipts/views/reject-receipt-modal.view';
import { UsersModule } from '@modules/users/users.module';
import { ReceiptsModule } from 'src/receipts/receipts.module';

// Receipts (More → Manage → Receipts, Admin and Finance): a month of a
// reimbursement with the decisions, and its child screen, Reimbursements.
@Module({
  imports: [
    SlackCommonModule,
    SlackTeamsModule,
    UsersModule,
    ReceiptsModule,
    ReceiptsSlackModule,
  ],
  providers: [
    ReceiptsTabActionHandler,
    RejectReceiptFormSubmitHandler,
    ReimbursementFormSubmitHandler,
    ArchiveReimbursementFormSubmitHandler,
    ReceiptsTabService,
    ReceiptsTabView,
    ReimbursementsView,
    RejectReceiptModalView,
    ReimbursementModalView,
    RejectReceiptParser,
    ReimbursementModalParser,
  ],
})
export class ReceiptsTabModule {}
