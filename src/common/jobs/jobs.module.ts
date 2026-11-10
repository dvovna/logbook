import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createJobQueue,
  DEFAULT_JOBS_OPTIONS,
  JOB_QUEUE,
  JOBS_OPTIONS,
  JobsService,
} from '@common/jobs/jobs.service';

@Global()
@Module({
  providers: [
    JobsService,
    { provide: JOBS_OPTIONS, useValue: DEFAULT_JOBS_OPTIONS },
    {
      provide: JOB_QUEUE,
      inject: [ConfigService, JOBS_OPTIONS],
      useFactory: createJobQueue,
    },
  ],
  exports: [JobsService],
})
export class JobsModule {}
