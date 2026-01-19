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

@Module({
  imports: [
    ProjectsModule,
    ClientsModule,
    SlackCommonModule,
  ],
  providers: [
    ProjectModalViewValuesParser,
    ProjectFormSubmitHandler,
    ProjectsTabActionHandler,
    DeleteProjectFormSubmitHandler,
    ProjectsTabService,
    ProjectsTabView,
    ProjectModalView,
  ],
  exports: [ProjectsTabService],
})
export class ProjectsTabModule {}
