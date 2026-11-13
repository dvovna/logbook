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
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { TimeTrackingUseService } from '@modules/slack/common/services/time-tracking-use.service';
import { ProjectsModule } from 'src/projects/projects.module';

@Module({
  imports: [
    SlackCommunicationModule,
    RequestWorkflowsModule,
    TimeEntriesModule,
    ProjectsModule,
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
    DmFileService,
    TimeTrackingUseService,
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
    DmFileService,
    TimeTrackingUseService,
  ],
})
export class SlackCommonModule {}
