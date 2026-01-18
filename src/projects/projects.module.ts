import { Module } from '@nestjs/common';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectsRepository } from 'src/projects/repositories/projects.repository';
import { ProjectsListQuery } from 'src/projects/queries/projects-list-query';

@Module({
  providers: [ProjectsRepository, ProjectsService, ProjectsListQuery],
  exports: [ProjectsService, ProjectsListQuery],
})
export class ProjectsModule {}
