import { Module } from '@nestjs/common';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { ProjectsModule } from 'src/projects/projects.module';

@Module({
  imports: [ProjectsModule],
  providers: [
    TimeEntriesRepository,
    TimeEntriesService,
    TimeEntriesValidationService,
  ],
  exports: [
    TimeEntriesService,
  ],
})
export class TimeEntriesModule {}
