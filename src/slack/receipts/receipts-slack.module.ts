import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { ReceiptDetailsSubmitHandler } from '@modules/slack/receipts/handlers/receipt-details-submit.handler';
import { ReceivedReceiptMessageHandler } from '@modules/slack/receipts/handlers/received-receipt-message.handler';
import { ReceiptDetailsParser } from '@modules/slack/receipts/parsers/receipt-details.parser';
import { ReceiptIntakeService } from '@modules/slack/receipts/services/receipt-intake.service';
import { ReceiptDetailsModalView } from '@modules/slack/receipts/views/receipt-details-modal.view';
import { ReceivedReceiptMessageView } from '@modules/slack/receipts/views/received-receipt-message.view';
import { ReceiptsModule } from 'src/receipts/receipts.module';

@Module({
  imports: [SlackCommonModule, SlackTeamsModule, ReceiptsModule],
  providers: [
    ReceiptIntakeService,
    ReceivedReceiptMessageView,
    ReceiptDetailsModalView,
    ReceiptDetailsParser,
    ReceivedReceiptMessageHandler,
    ReceiptDetailsSubmitHandler,
  ],
  exports: [ReceiptIntakeService, ReceiptDetailsModalView],
})
export class ReceiptsSlackModule {}
