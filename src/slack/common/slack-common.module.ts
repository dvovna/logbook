import { RejectWithReasonModalView } from '@modules/slack/common/views/components/reject-with-reason-modal.view';
import RejectReasonModalViewValuesParser from '@modules/slack/common/parsers/reject-reason-modal-view-values.parser';
import { Module } from '@nestjs/common';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { FallbackTabView } from '@modules/slack/common/views/fallback-tab.view';
import { FallbackTabActionHandler } from '@modules/slack/common/handlers/fallback-tab-action.handler';
import { InactiveUserTabView } from '@modules/slack/common/views/inactive-user-tab.view';
import { PendingApprovalsService } from '@modules/slack/common/services/pending-approvals.service';
import { RequestWorkflowsModule } from '@modules/request-workflows/request-workflows.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';

@Module({
  imports: [
    SlackCommunicationModule,
    RequestWorkflowsModule,
    TimeEntriesModule,
  ],
  providers: [
    ConfirmationModalView,
    RejectWithReasonModalView,
    RejectReasonModalViewValuesParser,
    TabNavigationService,
    SlackActionPermissionsService,
    FallbackTabView,
    FallbackTabActionHandler,
    InactiveUserTabView,
    PendingApprovalsService,
  ],
  exports: [
    ConfirmationModalView,
    RejectWithReasonModalView,
    RejectReasonModalViewValuesParser,
    TabNavigationService,
    SlackCommunicationModule,
    SlackActionPermissionsService,
    FallbackTabView,
    InactiveUserTabView,
    PendingApprovalsService,
  ],
})
export class SlackCommonModule {}
