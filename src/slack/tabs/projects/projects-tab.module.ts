import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import ProjectsTabActionHandler from '@modules/slack/tabs/projects/handlers/projects-tab-action.handler';
import { ProjectsTabService } from '@modules/slack/tabs/projects/services/projects-tab.service';
import { ProjectsTabView } from '@modules/slack/tabs/projects/views/projects-tab.view';
import { ProjectModalView } from '@modules/slack/tabs/projects/views/project-modal.view';
import { ProjectsModule } from 'src/projects/projects.module';
import { ProjectFormSubmitHandler } from '@modules/slack/tabs/projects/handlers/project-form-submit.handler';
import ProjectModalViewValuesParser from '@modules/slack/tabs/projects/parsers/project-modal-view-values.parser';
import {
  DeleteProjectFormSubmitHandler,
} from '@modules/slack/tabs/projects/handlers/delete-project-form-submit.handler';
import { ClientsModule } from '@modules/clients/clients.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { ProjectAssignmentsModalView } from '@modules/slack/tabs/projects/views/project-assignments-modal.view';
import { UsersModule } from '@modules/users/users.module';
import ProjectAssignmentsModalViewValuesParser
  from '@modules/slack/tabs/projects/parsers/project-assignments-modal-view-values.parser';
import {
  ProjectAssignmentsFormSubmitHandler,
} from '@modules/slack/tabs/projects/handlers/project-assignments-form-submit.handler';

@Module({
  imports: [
    ProjectsModule,
    TeamsModule,
    UsersModule,
    ClientsModule,
    SlackCommonModule,
  ],
  providers: [
    ProjectAssignmentsModalView,
    ProjectModalViewValuesParser,
    ProjectAssignmentsModalViewValuesParser,
    ProjectFormSubmitHandler,
    ProjectsTabActionHandler,
    DeleteProjectFormSubmitHandler,
    ProjectAssignmentsFormSubmitHandler,
    ProjectsTabService,
    ProjectsTabView,
    ProjectModalView,

  ],
  exports: [ProjectsTabService],
})
export class ProjectsTabModule {}
