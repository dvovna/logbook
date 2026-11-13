import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { ReceiptRejectedMessageHandler } from '@modules/slack/receipts/handlers/receipt-rejected-message.handler';
import { ReceiptDetailsSubmitHandler } from '@modules/slack/receipts/handlers/receipt-details-submit.handler';
import { ReceivedReceiptMessageHandler } from '@modules/slack/receipts/handlers/received-receipt-message.handler';
import { RemindersFormSubmitHandler } from '@modules/slack/receipts/handlers/reminders-form-submit.handler';
import { RemindersFormParser } from '@modules/slack/receipts/parsers/reminders-form.parser';
import { RemindersModalService } from '@modules/slack/receipts/services/reminders-modal.service';
import { RemindersModalView } from '@modules/slack/receipts/views/reminders-modal.view';
import { ReceiptDetailsParser } from '@modules/slack/receipts/parsers/receipt-details.parser';
import { ReceiptRejectionNotifier } from '@modules/slack/receipts/services/receipt-rejection-notifier.service';
import { ReceiptFilesDmService } from '@modules/slack/receipts/services/receipt-files-dm.service';
import { ReceiptIntakeService } from '@modules/slack/receipts/services/receipt-intake.service';
import { ReceiptDetailsModalView } from '@modules/slack/receipts/views/receipt-details-modal.view';
import { ReceiptRejectedMessageView } from '@modules/slack/receipts/views/receipt-rejected-message.view';
import { ReceivedReceiptMessageView } from '@modules/slack/receipts/views/received-receipt-message.view';
import { UsersModule } from '@modules/users/users.module';
import { ReceiptsModule } from 'src/receipts/receipts.module';

@Module({
  imports: [SlackCommonModule, SlackTeamsModule, ReceiptsModule, UsersModule],
  providers: [
    ReceiptIntakeService,
    ReceiptFilesDmService,
    ReceivedReceiptMessageView,
    ReceiptRejectedMessageView,
    ReceiptRejectionNotifier,
    ReceiptRejectedMessageHandler,
    ReceiptDetailsModalView,
    ReceiptDetailsParser,
    ReceivedReceiptMessageHandler,
    ReceiptDetailsSubmitHandler,
    RemindersModalView,
    RemindersFormParser,
    RemindersModalService,
    RemindersFormSubmitHandler,
  ],
  exports: [
    ReceiptIntakeService,
    ReceiptFilesDmService,
    ReceiptDetailsModalView,
    RemindersModalService,
  ],
})
export class ReceiptsSlackModule {}
