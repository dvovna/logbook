import { reportError } from '@common/errors/error-reporter';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as PgBoss from 'pg-boss';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import delay from '@common/utils/delay';
import { trackInBackground } from '@common/utils/run-in-background';

export interface IJobsOptions {
  // The Postgres schema of pg-boss's tables. The integration tests give each
  // app its own, so that test runs never take each other's jobs.
  schema: string;
  // How often the jobs due for a retry are run; 0 leaves it to runDueJobs().
  pollIntervalSeconds: number;
  // pg-boss's archiving and expiry of jobs.
  maintenance: boolean;
}

export const JOBS_OPTIONS = Symbol('JOBS_OPTIONS');

export const DEFAULT_JOBS_OPTIONS: IJobsOptions = {
  schema: 'pgboss',
  pollIntervalSeconds: 30,
  maintenance: true,
};

// A job's first run happens at once, in the process that asked for it. Its
// saved copy waits this long before a worker may take it, so that a slow
// first run is not repeated while it still runs.
export const FIRST_RETRY_AFTER_SECONDS = 5 * 60;

// Then up to 8 retries, each about twice as late as the one before, from 1-2
// minutes to 2-4 hours: enough to wait out a Slack or Supabase outage.
const RETRY_LIMIT = 8;
const RETRY_DELAY_SECONDS = 60;

// A job that started and never ended (its process died) is retried after this.
const EXPIRE_IN_SECONDS = 15 * 60;

const DEADLOCK_DETECTED = '40P01';

type JobHandler<Payload> = (payload: Payload) => Promise<void>;

// Work that has to happen even when Slack or the database fails for a while:
// asking approvers, updating their messages, telling people of decisions.
//
// run() saves the job in Postgres (pg-boss) and runs it right away. When the
// run succeeds the saved job is deleted; when it fails or the process stops,
// a worker retries it later. Without DATABASE_URL a job runs once, as all
// background work did before. Handlers take IDs and load what they need, so
// a retry sees the current data, and must be safe to run twice: a retry can
// follow a run that did part of the work.
@Injectable()
export class JobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobsService.name);

  private readonly handlers = new Map<string, JobHandler<object>>();

  private readonly boss: PgBoss | null;

  private started: Promise<void> | null = null;

  private poller: NodeJS.Timeout | null = null;

  public constructor(
    config: ConfigService,
    @Inject(JOBS_OPTIONS) private readonly options: IJobsOptions,
  ) {
    const connectionString = config.get<string>(
      EnvironmentVariable.DatabaseUrl,
    );

    this.boss = connectionString
      ? new PgBoss({
          connectionString,
          schema: options.schema,
          application_name: 'logbook-jobs',
          // Supabase's pooler allows few connections per project.
          max: 2,
          schedule: false,
          supervise: options.maintenance,
        })
      : null;
  }

  // The services that own a job define it in onModuleInit, before the app
  // starts and the worker can take saved jobs.
  public define<Payload extends object>(
    name: string,
    handler: JobHandler<Payload>,
  ) {
    if (this.handlers.has(name)) {
      throw new Error(`Job ${name} is defined twice`);
    }

    this.handlers.set(name, handler as JobHandler<object>);
  }

  // Callers don't wait: the job counts as background work, which the shutdown
  // and the integration tests wait for.
  public run<Payload extends object>(name: string, payload: Payload) {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new Error(`Job ${name} is not defined`);
    }

    trackInBackground(this.runNow(name, handler, payload));
  }

  // Runs the saved jobs whose time has come: retries, and jobs a stopped
  // process left. `includeNotDue` runs the waiting ones as well (tests).
  public async runDueJobs({ includeNotDue = false } = {}) {
    if (!this.boss) {
      return;
    }

    await this.started;

    for (const [queue, handler] of this.handlers) {
      const jobs = await this.boss.fetch<object>(queue, {
        batchSize: 20,
        ignoreStartAfter: includeNotDue,
        includeMetadata: true,
      });

      for (const job of jobs) {
        try {
          await handler(job.data);
          await this.boss.complete(queue, job.id);
        } catch (error) {
          const isLastTry = job.retryCount >= job.retryLimit;

          this.logFailure(
            queue,
            error as Error,
            isLastTry ? 'gives up after its last retry' : 'will be retried',
            isLastTry,
          );
          await this.boss.fail(queue, job.id, {
            message: (error as Error).message,
          });
        }
      }
    }
  }

  public onApplicationBootstrap() {
    if (!this.boss) {
      this.logger.warn(
        'DATABASE_URL is not set: background jobs run once, without retries',
      );

      return;
    }

    this.started = this.start(this.boss);

    return this.started;
  }

  public async onApplicationShutdown() {
    if (this.poller) {
      clearInterval(this.poller);
    }

    // The background work, saved jobs included, was waited for before
    // (BackgroundWorkShutdownService); what still runs is retried later.
    await this.boss?.stop({ graceful: false, wait: true, timeout: 5_000 });
  }

  private async start(boss: PgBoss) {
    boss.on('error', (error) =>
      this.logger.error(`Job queue: ${error.message}`, error.stack),
    );

    await boss.start();

    for (const queue of this.handlers.keys()) {
      await this.createQueue(boss, queue);
    }

    if (this.options.pollIntervalSeconds > 0) {
      this.poller = setInterval(
        () =>
          trackInBackground(
            this.runDueJobs().catch((error: Error) =>
              this.logger.error(
                `Failed to run due jobs: ${error.message}`,
                error.stack,
              ),
            ),
          ),
        this.options.pollIntervalSeconds * 1000,
      );
      this.poller.unref();
    }
  }

  // pg-boss creates a table per queue. Two instances doing that at once can
  // deadlock; Postgres rolls back one of them, which tries again.
  private async createQueue(boss: PgBoss, queue: string) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await boss.createQueue(queue, {
          name: queue,
          retryLimit: RETRY_LIMIT,
          retryDelay: RETRY_DELAY_SECONDS,
          retryBackoff: true,
          expireInSeconds: EXPIRE_IN_SECONDS,
        });

        return;
      } catch (error) {
        if (
          (error as { code?: string }).code !== DEADLOCK_DETECTED ||
          attempt === 5
        ) {
          throw error;
        }

        await delay(100 * attempt + Math.random() * 100);
      }
    }
  }

  private async runNow(
    name: string,
    handler: JobHandler<object>,
    payload: object,
  ) {
    const id = await this.save(name, payload);

    try {
      await handler(payload);
    } catch (error) {
      // Without a saved copy nothing retries it: that was its only try.
      this.logFailure(name, error as Error, id ? 'will be retried' : null, !id);

      return;
    }

    if (id) {
      await this.boss!.deleteJob(name, id).catch((error: Error) =>
        this.logger.error(
          `Failed to delete the done job ${name} ${id}: ${error.message}`,
        ),
      );
    }
  }

  // The saved copy, for a retry. If saving fails the job still runs once.
  private async save(name: string, payload: object) {
    if (!this.boss) {
      return null;
    }

    try {
      await this.started;

      return await this.boss.send(name, payload, {
        startAfter: FIRST_RETRY_AFTER_SECONDS,
      });
    } catch (error) {
      this.logger.error(
        `Failed to save job ${name}, running it once without retries: ${(error as Error).message}`,
      );

      return null;
    }
  }

  // A job that won't run again is reported (error tracking); one that will
  // be retried is only logged.
  private logFailure(
    name: string,
    error: Error,
    retry: string | null,
    isFinal: boolean,
  ) {
    this.logger.error(
      `Job ${name} failed${retry ? ` and ${retry}` : ''}: ${error.message}`,
      error.stack,
    );

    if (isFinal) {
      reportError(error, { job: name });
    }
  }
}
