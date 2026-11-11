import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import {
  createJobQueue,
  DEFAULT_JOBS_OPTIONS,
  IJobsOptions,
  JOB_QUEUE,
  JOBS_OPTIONS,
  JobsService,
} from '@common/jobs/jobs.service';

@Global()
@Module({
  providers: [
    JobsService,
    {
      provide: JOBS_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IJobsOptions => ({
        ...DEFAULT_JOBS_OPTIONS,
        concurrency:
          config.get<number>(EnvironmentVariable.JobsConcurrency) ??
          DEFAULT_JOBS_OPTIONS.concurrency,
      }),
    },
    {
      provide: JOB_QUEUE,
      inject: [ConfigService, JOBS_OPTIONS],
      useFactory: createJobQueue,
    },
  ],
  exports: [JobsService],
})
export class JobsModule {}
