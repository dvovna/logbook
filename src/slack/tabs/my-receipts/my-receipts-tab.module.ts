import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { ReceiptsSlackModule } from '@modules/slack/receipts/receipts-slack.module';
import { DeleteReceiptFormSubmitHandler } from '@modules/slack/tabs/my-receipts/handlers/delete-receipt-form-submit.handler';
import { MyReceiptsTabActionHandler } from '@modules/slack/tabs/my-receipts/handlers/my-receipts-tab-action.handler';
import { MyReceiptsTabService } from '@modules/slack/tabs/my-receipts/services/my-receipts-tab.service';
import { MyReceiptsTabView } from '@modules/slack/tabs/my-receipts/views/my-receipts-tab.view';
import { ReceiptsModule } from 'src/receipts/receipts.module';

// My receipts (Home → My receipts): the person's receipts with Edit and
// Delete. The details form is the DM's (ReceiptsSlackModule).
@Module({
  imports: [
    SlackCommonModule,
    SlackTeamsModule,
    ReceiptsModule,
    ReceiptsSlackModule,
  ],
  providers: [
    MyReceiptsTabActionHandler,
    DeleteReceiptFormSubmitHandler,
    MyReceiptsTabService,
    MyReceiptsTabView,
  ],
})
export class MyReceiptsTabModule {}
