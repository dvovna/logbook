import { Global, Module } from '@nestjs/common';
import {
  DEFAULT_JOBS_OPTIONS,
  JOBS_OPTIONS,
  JobsService,
} from '@common/jobs/jobs.service';

@Global()
@Module({
  providers: [
    JobsService,
    { provide: JOBS_OPTIONS, useValue: DEFAULT_JOBS_OPTIONS },
  ],
  exports: [JobsService],
})
export class JobsModule {}
