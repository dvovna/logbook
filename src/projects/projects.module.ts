import { Module } from '@nestjs/common';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectsRepository } from 'src/projects/repositories/projects.repository';
import { ProjectsListQuery } from 'src/projects/queries/projects-list.query';
import { ProjectAssignmentsService } from 'src/projects/services/project-assignments.service';
import { ProjectTeamsRepository } from 'src/projects/repositories/project-teams.repository';
import { ProjectUsersRepository } from 'src/projects/repositories/project-users.repository';
import { AssignProjectAssignmentsQuery } from 'src/projects/queries/assign-project-assignments.query';

@Module({
  providers: [
    ProjectsRepository,
    ProjectTeamsRepository,
    ProjectUsersRepository,
    ProjectsService,
    ProjectsListQuery,
    AssignProjectAssignmentsQuery,
    ProjectAssignmentsService,
  ],
  exports: [ProjectsService, ProjectsListQuery, ProjectAssignmentsService],
})
export class ProjectsModule {}
