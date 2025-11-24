import { Module } from '@nestjs/common';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { FallbackTabView } from '@modules/slack/common/views/fallback-tab.view';
import { FallbackTabActionHandler } from '@modules/slack/common/handlers/fallback-tab-action.handler';
import { InactiveUserTabView } from '@modules/slack/common/views/inactive-user-tab.view';

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
