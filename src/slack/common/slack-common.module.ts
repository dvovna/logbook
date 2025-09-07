import { Module } from '@nestjs/common';
import ConfirmationModalView from 'src/slack/common/views/confirmation-modal.view';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';

@Module({
  imports: [SlackCommunicationModule],
  providers: [ConfirmationModalView, TabNavigationService],
  exports: [
    ConfirmationModalView,
    TabNavigationService,
    SlackCommunicationModule,
  ],
})
export class SlackCommonModule {}
