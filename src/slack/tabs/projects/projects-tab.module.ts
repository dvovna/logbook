import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import ProjectsTabActionHandler from '@modules/slack/tabs/projects/handlers/projects-tab-action.handler';
import { ProjectsTabService } from '@modules/slack/tabs/projects/services/projects-tab.service';
import { ProjectsTabView } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ProjectModalView } from '@modules/slack/tabs/projects/views/project-modal.view';
import { ProjectsModule } from 'src/projects/projects.module';
import { ProjectFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/project-form-submit.handler';
import ProjectModalViewValuesParser from '@modules/slack/tabs/projects/parsers/project-modal-view-values.parser';
import { ChangeProjectStatusFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/change-project-status-form-submit.handler';
import { ClientsModule } from '@modules/clients/clients.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { ProjectAssignmentsModalView } from '@modules/slack/tabs/projects/views/project-assignments-modal.view';
import { UsersModule } from '@modules/users/users.module';
import ProjectAssignmentsModalViewValuesParser from '@modules/slack/tabs/projects/parsers/project-assignments-modal-view-values.parser';
import { ProjectAssignmentsFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/project-assignments-form-submit.handler';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { PersonRateModalView } from '@modules/slack/tabs/projects/views/person-rate-modal.view';
import PersonRateModalViewValuesParser from '@modules/slack/tabs/projects/parsers/person-rate-modal-view-values.parser';
import { PersonRateFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/person-rate-form-submit.handler';
import { CurrencyModalView } from '@modules/slack/tabs/projects/views/currency-modal.view';
import CurrencyModalViewValuesParser from '@modules/slack/tabs/projects/parsers/currency-modal-view-values.parser';
import { CurrencyFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/currency-form-submit.handler';

import { TimeOffLoggingModule } from 'src/time-off-logging/time-off-logging.module';
import { TimeOffSettingsModalView } from '@modules/slack/tabs/projects/views/time-off-settings-modal.view';
import TimeOffSettingsModalViewValuesParser from '@modules/slack/tabs/projects/parsers/time-off-settings-modal-view-values.parser';
import { TimeOffSettingsFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/time-off-settings-form-submit.handler';

@Module({
  imports: [
    TimeOffLoggingModule,
    ProjectsModule,
    TeamsModule,
    UsersModule,
    ClientsModule,
    SlackTeamsModule,
    SlackCommonModule,
  ],
  providers: [
    ProjectAssignmentsModalView,
    ProjectModalViewValuesParser,
    ProjectAssignmentsModalViewValuesParser,
    ProjectFormSubmitHandler,
    ProjectsTabActionHandler,
    ChangeProjectStatusFormSubmitHandler,
    ProjectAssignmentsFormSubmitHandler,
    PersonRateModalView,
    PersonRateModalViewValuesParser,
    PersonRateFormSubmitHandler,
    CurrencyModalView,
    CurrencyModalViewValuesParser,
    CurrencyFormSubmitHandler,
    TimeOffSettingsModalView,
    TimeOffSettingsModalViewValuesParser,
    TimeOffSettingsFormSubmitHandler,
    ProjectsTabService,
    ProjectsTabView,
    ProjectModalView,
  ],
  exports: [ProjectsTabService],
})
export class ProjectsTabModule {}
