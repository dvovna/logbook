import { randomUUID } from 'node:crypto';
import { reportError } from '@common/errors/error-reporter';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { CLOSE_TIMEOUT_MS } from '@common/constants/shutdown';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import {
  IEnqueueManyOptions,
  IEnqueueSingletonOptions,
  IJobDefinitionOptions,
  ISavedJob,
  JobHandler,
} from '@common/jobs/types/jobs.types';
import { ConcurrencyLimit } from '@common/utils/concurrency-limit';
import delay from '@common/utils/delay';
import { finishesWithin } from '@common/utils/finishes-within';
import {
  startInBackground,
  trackInBackground,
} from '@common/utils/run-in-background';
import { TransactionService } from 'src/database/transaction.service';
import { singletonJobLock } from 'src/database/advisory-locks';

export interface IJobsOptions {
  // The Postgres schema of pg-boss's tables. The integration tests give each
  // app its own, so that test runs never take each other's jobs.
  schema: string;
  // How often the jobs due for a retry are run; 0 leaves it to runDueJobs().
  pollIntervalSeconds: number;
  // pg-boss's archiving and expiry of jobs.
  maintenance: boolean;
  // How many job runs this process runs at once (JOBS_CONCURRENCY), first
  // runs and retries together: a burst of jobs leaves the rest of the pool
  // to the queries people wait on. The others wait their turn, saved.
  concurrency: number;
}

export const JOBS_OPTIONS = Symbol('JOBS_OPTIONS');

export const DEFAULT_JOBS_OPTIONS: IJobsOptions = {
  schema: 'pgboss',
  pollIntervalSeconds: 30,
  maintenance: true,
  concurrency: 4,
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

// A first run that gets its slot only this close to the moment its saved
// copy becomes due leaves the job to the worker, which could otherwise run it
// a second time. The copy's moment counts from the start of the transaction
// that saved it, which can come a little before the save.
const FIRST_RUN_GIVES_WAY_MS = 60_000;

const DEADLOCK_DETECTED = '40P01';

// The pg-boss instance, from JobsModule; the unit tests give a fake.
export const JOB_QUEUE = Symbol('JOB_QUEUE');

export type JobQueue = Pick<
  PgBoss,
  | 'on'
  | 'start'
  | 'stop'
  | 'createQueue'
  | 'send'
  | 'insert'
  | 'fetch'
  | 'complete'
  | 'fail'
  | 'deleteJob'
>;

export const createJobQueue = (
  config: ConfigService,
  options: IJobsOptions,
): JobQueue =>
  new PgBoss({
    connectionString: config.getOrThrow<string>(
      EnvironmentVariable.DatabaseUrl,
    ),
    schema: options.schema,
    application_name: 'logbook-jobs',
    // Supabase's pooler allows few connections per project: these and
    // DATABASE_POOL_SIZE stay under its Pool Size.
    max: 3,
    schedule: false,
    supervise: options.maintenance,
  });

// Work that has to happen even when Slack or the database fails for a while:
// asking approvers, updating their messages, telling people of decisions.
//
// run() saves the job in Postgres (pg-boss) and runs it right away. When the
// run succeeds the saved job is deleted; when it fails or the process stops,
// a worker retries it later. Handlers take IDs and load what they need, so
// a retry sees the current data, and must be safe to run twice: a retry can
// follow a run that did part of the work.
//
// run() saves the job in the background, after its caller went on. A job
// that follows a change is enqueue()d instead, in the change's transaction
// (or, for a job that starts another, before the first one ends): a crash
// between the commit and a later save would leave the change without its
// job, and nothing to retry.
//
// At most `concurrency` runs go on at once; a job waits for a slot after it
// was saved. So a job must not await another job's run (run()): enough of
// them holding their slots would wait for each other for ever.
@Injectable()
export class JobsService
  implements OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(JobsService.name);

  private readonly handlers = new Map<string, JobHandler<object>>();

  private readonly giveUps = new Map<
    string,
    (payload: object) => Promise<void>
  >();

  private started: Promise<void> | null = null;

  private poller: NodeJS.Timeout | null = null;

  private readonly slots: ConcurrencyLimit;

  private stopped = false;

  public constructor(
    @Inject(JOB_QUEUE) private readonly boss: JobQueue,
    @Inject(JOBS_OPTIONS) private readonly options: IJobsOptions,
    private readonly transactions: TransactionService,
  ) {
    this.slots = new ConcurrencyLimit(options.concurrency);
  }

  // The services that own a job define it in onModuleInit, before the app
  // starts and the worker can take saved jobs.
  public define<Payload extends object>(
    name: string,
    handler: JobHandler<Payload>,
    { onGiveUp }: IJobDefinitionOptions<Payload> = {},
  ) {
    if (this.handlers.has(name)) {
      throw new Error(`Job ${name} is defined twice`);
    }

    this.handlers.set(name, handler as JobHandler<object>);

    if (onGiveUp) {
      this.giveUps.set(name, onGiveUp as (payload: object) => Promise<void>);
    }
  }

  // Callers needn't wait: the job counts as background work, which the
  // shutdown and the integration tests wait for. The promise resolves once the
  // first run is over, whether it succeeded or not (it never rejects), for a
  // caller that has more to do after it, such as re-rendering a tab.
  public run<Payload extends object>(
    name: string,
    payload: Payload,
  ): Promise<void> {
    const handler = this.handlerOf(name);

    return startInBackground(() => this.runNow(name, handler, payload));
  }

  // Inside a transaction (TransactionService), saves the job in it, so that
  // the job exists exactly when the data it is about was committed, and runs
  // it first once the transaction has committed. Outside one, saves it on the
  // pool and runs it at once. Either way it resolves once the job is saved,
  // not run, and throws when it couldn't be saved: a caller that finishes
  // after it (a job, an answer to Slack) leaves nothing that a crash could
  // lose.
  public async enqueue<Payload extends object>(
    name: string,
    payload: Payload,
  ): Promise<void> {
    const handler = this.handlerOf(name);

    await this.started;
    await this.saveToRunAfterCommit(name, handler, payload);
  }

  // enqueue() for work that must not run twice at once, such as a person's
  // export of one report: while a job of `name` with `singletonKey` is
  // saved (waiting for its first run or a retry) or runs, it saves and runs
  // nothing and resolves false. The check and the save are one transaction
  // under a lock, so that two clicks at once save one job.
  public async enqueueSingleton<Payload extends object>(
    name: string,
    singletonKey: string,
    payload: Payload,
    { firstRun }: IEnqueueSingletonOptions<Payload> = {},
  ): Promise<boolean> {
    const handler = this.handlerOf(name);

    await this.started;

    return this.transactions.transaction(async () => {
      await this.transactions.lock(singletonJobLock(name, singletonKey));

      if (await this.isPending(name, singletonKey)) {
        return false;
      }

      await this.saveToRunAfterCommit(
        name,
        (firstRun as JobHandler<object> | undefined) ?? handler,
        payload,
        { singletonKey },
      );

      return true;
    });
  }

  // enqueue() for many jobs of one kind, saved in one statement: a
  // transaction that enqueues hundreds holds its connection for one round
  // trip. Outside a transaction it saves them on the pool and starts them.
  // With `perSecond`, their first runs start at most that many a second.
  public async enqueueMany<Payload extends object>(
    name: string,
    payloads: Payload[],
    { perSecond }: IEnqueueManyOptions = {},
  ): Promise<void> {
    const handler = this.handlerOf(name);

    if (!payloads.length) {
      return;
    }

    await this.started;

    const intervalMs = perSecond ? 1000 / perSecond : 0;
    const savedAt = performance.now();
    const jobs = payloads.map((payload, index) => ({
      id: randomUUID(),
      payload,
      // A saved copy waits for its first run's turn too, so that no worker
      // takes it before the first run had its chance.
      waitSeconds:
        FIRST_RETRY_AFTER_SECONDS + Math.ceil((index * intervalMs) / 1000),
    }));

    await this.boss.insert(
      jobs.map(({ id, payload, waitSeconds }) => ({
        id,
        name,
        data: payload,
        // Seconds after Postgres's now(), as send() counts them.
        startAfter: String(waitSeconds),
      })),
      { db: this.transactions.sqlExecutor() },
    );

    this.transactions.afterCommit(() =>
      this.runSpaced(
        name,
        handler,
        jobs.map(({ id, payload, waitSeconds }) => ({
          payload,
          saved: { id, dueAt: savedAt + waitSeconds * 1000 },
        })),
        intervalMs,
      ),
    );
  }

  // Runs the saved jobs whose time has come: retries, and jobs a stopped
  // process left. `includeNotDue` runs the waiting ones as well (tests).
  public async runDueJobs({ includeNotDue = false } = {}) {
    await this.started;

    for (const [queue, handler] of this.handlers) {
      const jobs = await this.boss.fetch<object>(queue, {
        batchSize: 20,
        ignoreStartAfter: includeNotDue,
        includeMetadata: true,
      });

      for (const job of jobs) {
        await this.slots.run(async () => {
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

            if (isLastTry) {
              await this.giveUp(queue, job.data);
            }
          }
        });
      }
    }
  }

  public onApplicationBootstrap() {
    this.started = this.start(this.boss);

    return this.started;
  }

  // No retry starts once the app shuts down (onModuleDestroy comes first);
  // the ones running are background work, which the shutdown waits for.
  public onModuleDestroy() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

  public async onApplicationShutdown() {
    // The first runs that still wait for a slot or their turn: their saved
    // copies are retried, by the next process if need be.
    this.stopped = true;

    // The background work, saved jobs included, was waited for before
    // (BackgroundWorkShutdownService); what still runs is retried later.
    // Closing pg-boss's pool waits for its queries in flight.
    const stopped = await finishesWithin(
      this.boss.stop({ graceful: false, wait: true }),
      CLOSE_TIMEOUT_MS,
    );

    if (!stopped) {
      this.logger.warn(
        `The job queue was still stopping after ${CLOSE_TIMEOUT_MS} ms`,
      );
    }
  }

  private async start(boss: JobQueue) {
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
  private async createQueue(boss: JobQueue, queue: string) {
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

  // Saves the job on the current transaction (or the pool) and runs it with
  // `handler` once that commits.
  private async saveToRunAfterCommit(
    name: string,
    handler: JobHandler<object>,
    payload: object,
    options: { singletonKey?: string } = {},
  ) {
    const dueAt = performance.now() + FIRST_RETRY_AFTER_SECONDS * 1000;
    const id = await this.boss.send(name, payload, {
      ...options,
      startAfter: FIRST_RETRY_AFTER_SECONDS,
      db: this.transactions.sqlExecutor(),
    });

    this.transactions.afterCommit(() =>
      this.runInSlot(name, handler, payload, id ? { id, dueAt } : null),
    );
  }

  // Waiting for its first run or a retry (created, retry), or running
  // (active): pg-boss's job_state enum is in that order.
  private async isPending(name: string, singletonKey: string) {
    const { rows } = await this.transactions
      .sqlExecutor()
      .executeSql(
        `select 1 from "${this.options.schema}".job where name = $1 and singleton_key = $2 and state < 'completed' limit 1`,
        [name, singletonKey],
      );

    return rows.length > 0;
  }

  private handlerOf(name: string) {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new Error(`Job ${name} is not defined`);
    }

    return handler;
  }

  private async runNow(
    name: string,
    handler: JobHandler<object>,
    payload: object,
  ) {
    await this.runInSlot(
      name,
      handler,
      payload,
      await this.save(name, payload),
    );
  }

  private runInSlot(
    name: string,
    handler: JobHandler<object>,
    payload: object,
    saved: ISavedJob | null,
  ) {
    return this.slots.run(() => this.runFirst(name, handler, payload, saved));
  }

  // Starts the first runs one after another, `intervalMs` apart at least,
  // each once it has a slot: waiting for slots can't bunch them up.
  private async runSpaced(
    name: string,
    handler: JobHandler<object>,
    runs: { payload: object; saved: ISavedJob }[],
    intervalMs: number,
  ) {
    const started: Promise<void>[] = [];
    let nextAt = 0;

    for (const { payload, saved } of runs) {
      const wait = nextAt - performance.now();

      if (wait > 0) {
        await delay(wait);
      }

      if (this.stopped) {
        break;
      }

      const release = await this.slots.acquire();

      nextAt = performance.now() + intervalMs;
      started.push(
        this.runFirst(name, handler, payload, saved).finally(release),
      );
    }

    await Promise.all(started);
  }

  // The first run of a job saved as `saved` (null: not saved, its only run),
  // in its slot.
  private async runFirst(
    name: string,
    handler: JobHandler<object>,
    payload: object,
    saved: ISavedJob | null,
  ) {
    if (this.stopped) {
      return;
    }

    if (saved && performance.now() > saved.dueAt - FIRST_RUN_GIVES_WAY_MS) {
      this.logger.warn(
        `Job ${name} waited too long for a free slot: a worker runs its saved copy`,
      );

      return;
    }

    try {
      await handler(payload);
    } catch (error) {
      // Without a saved copy nothing retries it: that was its only try.
      this.logFailure(
        name,
        error as Error,
        saved ? 'will be retried' : null,
        !saved,
      );

      if (!saved) {
        await this.giveUp(name, payload);
      }

      return;
    }

    if (saved) {
      await this.boss
        .deleteJob(name, saved.id)
        .catch((error: Error) =>
          this.logger.error(
            `Failed to delete the done job ${name} ${saved.id}: ${error.message}`,
          ),
        );
    }
  }

  // The saved copy, for a retry. If saving fails the job still runs once.
  private async save(name: string, payload: object): Promise<ISavedJob | null> {
    try {
      await this.started;

      const dueAt = performance.now() + FIRST_RETRY_AFTER_SECONDS * 1000;
      const id = await this.boss.send(name, payload, {
        startAfter: FIRST_RETRY_AFTER_SECONDS,
      });

      return id ? { id, dueAt } : null;
    } catch (error) {
      this.logger.error(
        `Failed to save job ${name}, running it once without retries: ${(error as Error).message}`,
      );

      return null;
    }
  }

  private async giveUp(name: string, payload: object) {
    await this.giveUps
      .get(name)?.(payload)
      .catch((error: Error) =>
        this.logger.error(
          `Job ${name} gave up and failed to say so: ${error.message}`,
          error.stack,
        ),
      );
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
