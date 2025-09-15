import { Module } from '@nestjs/common';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';

@Module({
  imports: [SlackCommunicationModule],
  providers: [
    ConfirmationModalView,
    TabNavigationService,
    SlackActionPermissionsService,
  ],
  exports: [
    ConfirmationModalView,
    TabNavigationService,
    SlackCommunicationModule,
    SlackActionPermissionsService,
  ],
})
export class SlackCommonModule {}
