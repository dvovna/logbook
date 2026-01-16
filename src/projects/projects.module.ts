import { Module } from '@nestjs/common';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectsRepository } from 'src/projects/repositories/projects.repository';

@Module({
  providers: [ProjectsRepository, ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
