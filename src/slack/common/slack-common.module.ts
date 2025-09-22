import { Module } from '@nestjs/common';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';
import { FallbackTabView } from 'src/slack/tabs/fallback/views/fallback-tab.view';
import { FallbackTabActionHandler } from 'src/slack/tabs/fallback/handlers/fallback-tab-action.handler';

@Module({
  imports: [SlackCommunicationModule],
  providers: [
    ConfirmationModalView,
    TabNavigationService,
    SlackActionPermissionsService,
    FallbackTabView,
    FallbackTabActionHandler,
  ],
  exports: [
    ConfirmationModalView,
    TabNavigationService,
    SlackCommunicationModule,
    SlackActionPermissionsService,
    FallbackTabView,
  ],
})
export class SlackCommonModule {}
