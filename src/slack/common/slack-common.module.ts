import { Module } from '@nestjs/common';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';
import { FallbackTabView } from 'src/slack/common/views/fallback-tab.view';
import { FallbackTabActionHandler } from 'src/slack/common/handlers/fallback-tab-action.handler';
import { InactiveUserTabView } from 'src/slack/common/views/inactive-user-tab.view';

@Module({
  imports: [SlackCommunicationModule],
  providers: [
    ConfirmationModalView,
    TabNavigationService,
    SlackActionPermissionsService,
    FallbackTabView,
    FallbackTabActionHandler,
    InactiveUserTabView,
  ],
  exports: [
    ConfirmationModalView,
    TabNavigationService,
    SlackCommunicationModule,
    SlackActionPermissionsService,
    FallbackTabView,
    InactiveUserTabView,
  ],
})
export class SlackCommonModule {}
