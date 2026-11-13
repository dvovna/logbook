import { Logger } from '@nestjs/common';
import {
  DEFAULT_JOBS_OPTIONS,
  FIRST_RETRY_AFTER_SECONDS,
  IJobsOptions,
  JobQueue,
  JobsService,
} from '@common/jobs/jobs.service';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';
import { CLOSE_TIMEOUT_MS } from '@common/constants/shutdown';
import * as errorReporter from '@common/errors/error-reporter';
import { TransactionService } from 'src/database/transaction.service';
import { isInJob } from '@common/jobs/job-context';

// pg-boss without Postgres: it saves nothing and answers with job IDs. The
// integration tests cover the queue in Postgres (job-retries.int-spec.ts).
const fakeQueue = () => {
  let saved = 0;

  return {
    send: jest.fn(() => Promise.resolve(`job-${(saved += 1)}`)),
    insert: jest.fn(() => Promise.resolve()),
    deleteJob: jest.fn(() => Promise.resolve()),
    fetch: jest.fn(() => Promise.resolve([] as object[])),
    complete: jest.fn(() => Promise.resolve()),
    fail: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    createQueue: jest.fn(() => Promise.resolve()),
  };
};

describe('JobsService', () => {
  let jobs: JobsService;
  let queue: ReturnType<typeof fakeQueue>;
  let error: jest.SpyInstance;
  let report: jest.SpyInstance;
  const executor = { executeSql: jest.fn() };
  // What a transaction that has not committed yet runs after the commit.
  let transactions: {
    inTransaction: boolean;
    afterCommit: jest.Mock;
    sqlExecutor: () => typeof executor;
    transaction: (work: () => Promise<unknown>) => Promise<unknown>;
    lock: jest.Mock;
  };
  const sent: string[] = [];
  const notify = ({ to }: { to: string }) => {
    sent.push(to);

    return to === 'U_DOWN'
      ? Promise.reject(new Error('Slack is down'))
      : Promise.resolve();
  };

  beforeEach(async () => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    report = jest.spyOn(errorReporter, 'reportError').mockImplementation();
    sent.length = 0;
    queue = fakeQueue();
    executor.executeSql.mockReset().mockResolvedValue({ rows: [] });
    transactions = {
      inTransaction: false,
      afterCommit: jest.fn(),
      sqlExecutor: () => executor,
      transaction: (work) => work(),
      lock: jest.fn(() => Promise.resolve()),
    };
    jobs = new JobsService(
      queue as unknown as JobQueue,
      { ...DEFAULT_JOBS_OPTIONS, pollIntervalSeconds: 0 },
      transactions as unknown as TransactionService,
    );
    jobs.define('notify', notify);
    await jobs.onApplicationBootstrap();
  });

  afterEach(() => jest.restoreAllMocks());

  // Another JobsService on the same fake queue, with these options.
  const createJobs = (options: Partial<IJobsOptions>) => {
    const other = new JobsService(
      queue as unknown as JobQueue,
      { ...DEFAULT_JOBS_OPTIONS, pollIntervalSeconds: 0, ...options },
      transactions as unknown as TransactionService,
    );
    void other.onApplicationBootstrap();

    return other;
  };

  it('saves a job, runs it at once as background work, and deletes the saved copy', async () => {
    void jobs.run('notify', { to: 'U1' });
    expect(sent).toEqual([]);

    await whenBackgroundWorkIsDone();

    expect(sent).toEqual(['U1']);
    expect(queue.send).toHaveBeenCalledWith(
      'notify',
      { to: 'U1' },
      { startAfter: FIRST_RETRY_AFTER_SECONDS },
    );
    expect(queue.deleteJob).toHaveBeenCalledWith('notify', 'job-1');
  });

  it('keeps a failed job for its retry and only logs the failure', async () => {
    void jobs.run('notify', { to: 'U_DOWN' });
    await whenBackgroundWorkIsDone();

    expect(error).toHaveBeenCalledWith(
      'Job notify failed and will be retried: Slack is down',
      expect.any(String),
    );
    expect(queue.deleteJob).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('runs a job once when it cannot be saved, and reports its failure', async () => {
    queue.send.mockRejectedValue(new Error('connection refused'));

    void jobs.run('notify', { to: 'U_DOWN' });
    await whenBackgroundWorkIsDone();

    expect(error).toHaveBeenCalledWith(
      'Failed to save job notify, running it once without retries: connection refused',
    );
    expect(error).toHaveBeenCalledWith(
      'Job notify failed: Slack is down',
      expect.any(String),
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Slack is down' }),
      { job: 'notify' },
    );
  });

  it('completes a retried job, and reports one that failed its last retry', async () => {
    queue.fetch.mockResolvedValueOnce([
      { id: 'j1', data: { to: 'U1' }, retryCount: 1, retryLimit: 8 },
      { id: 'j2', data: { to: 'U_DOWN' }, retryCount: 8, retryLimit: 8 },
    ]);

    await jobs.runDueJobs();

    expect(sent).toEqual(['U1', 'U_DOWN']);
    expect(queue.complete).toHaveBeenCalledWith('notify', 'j1');
    expect(queue.fail).toHaveBeenCalledWith('notify', 'j2', {
      message: 'Slack is down',
    });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('saves a job enqueued in a transaction on its connection, and runs it after the commit', async () => {
    transactions.inTransaction = true;

    await jobs.enqueue('notify', { to: 'U1' });
    await whenBackgroundWorkIsDone();

    expect(queue.send).toHaveBeenCalledWith(
      'notify',
      { to: 'U1' },
      { startAfter: FIRST_RETRY_AFTER_SECONDS, db: executor },
    );
    expect(sent).toEqual([]);

    const [[commit]] = transactions.afterCommit.mock.calls as [
      [() => Promise<void>],
    ];
    await commit();

    expect(sent).toEqual(['U1']);
    expect(queue.deleteJob).toHaveBeenCalledWith('notify', 'job-1');
  });

  // Outside a transaction sqlExecutor() is the pool, and afterCommit runs
  // the work at once.
  it('saves a job enqueued outside a transaction on the pool before it resolves, then runs it', async () => {
    await jobs.enqueue('notify', { to: 'U1' });

    expect(queue.send).toHaveBeenCalledWith(
      'notify',
      { to: 'U1' },
      { startAfter: FIRST_RETRY_AFTER_SECONDS, db: executor },
    );
    expect(sent).toEqual([]);

    const [[runNow]] = transactions.afterCommit.mock.calls as [
      [() => Promise<void>],
    ];
    await runNow();

    expect(sent).toEqual(['U1']);
    expect(queue.deleteJob).toHaveBeenCalledWith('notify', 'job-1');
  });

  it('throws when it cannot save an enqueued job, and runs nothing', async () => {
    queue.send.mockRejectedValueOnce(new Error('connection refused'));

    await expect(jobs.enqueue('notify', { to: 'U1' })).rejects.toThrow(
      'connection refused',
    );

    expect(transactions.afterCommit).not.toHaveBeenCalled();
  });

  describe('enqueueSingleton', () => {
    const runAfterCommit = async () => {
      const [[afterCommit]] = transactions.afterCommit.mock.calls as [
        [() => Promise<void>],
      ];

      await afterCommit();
    };

    it('saves the job with its key under a lock, and runs its first run instead of the handler', async () => {
      const firstRun = jest.fn(() => Promise.resolve());

      expect(
        await jobs.enqueueSingleton(
          'notify',
          'U1:june',
          { to: 'U1' },
          {
            firstRun,
          },
        ),
      ).toBe(true);

      expect(transactions.lock).toHaveBeenCalledWith({
        key: 'job:notify:U1:june',
        rank: expect.any(Number),
      });
      expect(executor.executeSql).toHaveBeenCalledWith(
        expect.stringContaining(`"pgboss".job where name = $1`),
        ['notify', 'U1:june'],
      );
      expect(queue.send).toHaveBeenCalledWith(
        'notify',
        { to: 'U1' },
        {
          singletonKey: 'U1:june',
          startAfter: FIRST_RETRY_AFTER_SECONDS,
          db: executor,
        },
      );

      await runAfterCommit();

      expect(firstRun).toHaveBeenCalledWith({ to: 'U1' });
      expect(sent).toEqual([]);
      expect(queue.deleteJob).toHaveBeenCalledWith('notify', 'job-1');
    });

    it('saves and runs nothing while a job of another name it waits for has the key', async () => {
      executor.executeSql
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{}] });

      expect(
        await jobs.enqueueSingleton(
          'notify',
          'U1:june',
          { to: 'U1' },
          { pendingAlso: ['notify-part'] },
        ),
      ).toBe(false);

      expect(executor.executeSql).toHaveBeenLastCalledWith(
        expect.stringContaining(`"pgboss".job where name = $1`),
        ['notify-part', 'U1:june'],
      );
      expect(queue.send).not.toHaveBeenCalled();
    });

    it('saves and runs nothing while a job with the key is pending', async () => {
      executor.executeSql.mockResolvedValueOnce({ rows: [{}] });

      expect(
        await jobs.enqueueSingleton('notify', 'U1:june', { to: 'U1' }),
      ).toBe(false);

      expect(queue.send).not.toHaveBeenCalled();
      expect(transactions.afterCommit).not.toHaveBeenCalled();
    });
  });

  describe('onGiveUp', () => {
    const givenUp: object[] = [];

    beforeEach(() => {
      givenUp.length = 0;
      jobs.define('export', notify, {
        onGiveUp: (payload) => {
          givenUp.push(payload);

          return Promise.resolve();
        },
      });
    });

    it('runs once the last retry failed, not before', async () => {
      queue.fetch.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: 'j1', data: { to: 'U_DOWN' }, retryCount: 7, retryLimit: 8 },
        {
          id: 'j2',
          data: { to: 'U_DOWN', last: true },
          retryCount: 8,
          retryLimit: 8,
        },
      ]);

      await jobs.runDueJobs();

      expect(givenUp).toEqual([{ to: 'U_DOWN', last: true }]);
    });

    it('runs when a job that could not be saved failed its only run', async () => {
      queue.send.mockRejectedValue(new Error('connection refused'));

      void jobs.run('export', { to: 'U_DOWN' });
      await whenBackgroundWorkIsDone();

      expect(givenUp).toEqual([{ to: 'U_DOWN' }]);
    });

    it('does not run when a first run with a saved copy fails', async () => {
      void jobs.run('export', { to: 'U_DOWN' });
      await whenBackgroundWorkIsDone();

      expect(givenUp).toEqual([]);
    });
  });

  describe('shutdown', () => {
    afterEach(() => jest.useRealTimers());

    it('stops polling for retries before the app waits for its work', async () => {
      jest.useFakeTimers();
      const polling = createJobs({ pollIntervalSeconds: 30 });
      await jest.advanceTimersByTimeAsync(0);

      polling.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(queue.fetch).not.toHaveBeenCalled();
    });

    it('goes on when the queue takes too long to stop, and says so', async () => {
      jest.useFakeTimers();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      queue.stop.mockReturnValue(new Promise(() => {}));

      const shutdown = jobs.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(CLOSE_TIMEOUT_MS);
      await shutdown;

      expect(warn).toHaveBeenCalledWith(
        `The job queue was still stopping after ${CLOSE_TIMEOUT_MS} ms`,
      );
    });
  });

  describe('enqueueMany', () => {
    const commit = async () => {
      const [[afterCommit]] = transactions.afterCommit.mock.calls as [
        [() => Promise<void>],
      ];

      await afterCommit();
    };

    it('saves the jobs in one statement on the transaction, waiting as enqueue() saves one, and runs them after the commit', async () => {
      transactions.inTransaction = true;

      await jobs.enqueueMany('notify', [{ to: 'U1' }, { to: 'U2' }]);

      expect(queue.send).not.toHaveBeenCalled();
      expect(queue.insert).toHaveBeenCalledTimes(1);
      expect(queue.insert).toHaveBeenCalledWith(
        [
          {
            id: expect.any(String),
            name: 'notify',
            data: { to: 'U1' },
            startAfter: String(FIRST_RETRY_AFTER_SECONDS),
          },
          {
            id: expect.any(String),
            name: 'notify',
            data: { to: 'U2' },
            startAfter: String(FIRST_RETRY_AFTER_SECONDS),
          },
        ],
        { db: executor },
      );
      expect(sent).toEqual([]);

      await commit();

      const [[saved]] = queue.insert.mock.calls as unknown as [
        [{ id: string }[]],
      ];
      expect(sent).toEqual(['U1', 'U2']);
      expect(queue.deleteJob.mock.calls).toEqual(
        saved.map(({ id }) => ['notify', id]),
      );
    });

    it('gives every job the singleton key it is given', async () => {
      transactions.inTransaction = true;

      await jobs.enqueueMany('notify', [{ to: 'U1' }, { to: 'U2' }], {
        singletonKey: 'U1:june',
      });

      const [[saved]] = queue.insert.mock.calls as unknown as [
        [{ singletonKey?: string }[]],
      ];

      expect(saved.map(({ singletonKey }) => singletonKey)).toEqual([
        'U1:june',
        'U1:june',
      ]);
    });

    it('saves nothing for no jobs', async () => {
      transactions.inTransaction = true;

      await jobs.enqueueMany('notify', []);

      expect(queue.insert).not.toHaveBeenCalled();
      expect(transactions.afterCommit).not.toHaveBeenCalled();
    });

    describe('with perSecond', () => {
      beforeEach(() => jest.useFakeTimers());

      afterEach(() => jest.useRealTimers());

      it('starts the first runs at most that many a second, and saves each copy for after its turn', async () => {
        const startedAt: number[] = [];
        const begin = performance.now();
        jobs.define('remind', () => {
          startedAt.push(performance.now() - begin);

          return Promise.resolve();
        });
        transactions.inTransaction = true;

        await jobs.enqueueMany(
          'remind',
          Array.from({ length: 12 }, (_, index) => ({ index })),
          { perSecond: 5 },
        );
        const done = commit();
        await jest.advanceTimersByTimeAsync(5_000);
        await done;

        expect(startedAt).toEqual([
          0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200,
        ]);
        const [[saved]] = queue.insert.mock.calls as unknown as [
          [{ startAfter: string }[]],
        ];
        // A copy becomes due 5 minutes after its own turn at the latest.
        expect(saved.map(({ startAfter }) => Number(startAfter))).toEqual(
          [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3].map(
            (seconds) => FIRST_RETRY_AFTER_SECONDS + seconds,
          ),
        );
      });

      it('keeps them apart after a wait for a free slot', async () => {
        const slow = createJobs({ concurrency: 1 });
        const startedAt: number[] = [];
        const begin = performance.now();
        slow.define<{ index: number }>('remind', async ({ index }) => {
          startedAt.push(performance.now() - begin);

          if (index === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        });
        transactions.inTransaction = true;

        await slow.enqueueMany(
          'remind',
          Array.from({ length: 4 }, (_, index) => ({ index })),
          { perSecond: 5 },
        );
        const done = commit();
        await jest.advanceTimersByTimeAsync(5_000);
        await done;

        expect(startedAt).toEqual([0, 1000, 1200, 1400]);
      });
    });
  });

  describe('concurrency', () => {
    // Jobs that run until the test ends them, by name.
    const blocked = new Map<string, () => void>();
    const started: string[] = [];
    const block = ({ to }: { to: string }) => {
      started.push(to);

      return new Promise<void>((resolve) => blocked.set(to, resolve));
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const end = async (to: string) => {
      blocked.get(to)!();
      await flush();
    };

    beforeEach(() => {
      blocked.clear();
      started.length = 0;
    });

    it('runs at most `concurrency` jobs at once, first runs and retries alike', async () => {
      const limited = createJobs({ concurrency: 2 });
      limited.define('block', block);

      void limited.run('block', { to: 'U1' });
      void limited.run('block', { to: 'U2' });
      void limited.run('block', { to: 'U3' });
      await flush();
      expect(started).toEqual(['U1', 'U2']);

      queue.fetch.mockResolvedValueOnce([
        { id: 'j1', data: { to: 'U4' }, retryCount: 1, retryLimit: 8 },
      ]);
      const retries = limited.runDueJobs();

      await end('U1');
      expect(started).toEqual(['U1', 'U2', 'U3']);

      await end('U2');
      expect(started).toEqual(['U1', 'U2', 'U3', 'U4']);

      await end('U3');
      await end('U4');
      await retries;
      await whenBackgroundWorkIsDone();
      expect(queue.complete).toHaveBeenCalledWith('block', 'j1');
    });

    it('leaves a job that waited for a slot until its saved copy was due to the worker', async () => {
      jest.useFakeTimers();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      try {
        const limited = createJobs({ concurrency: 1 });
        limited.define('block', block);

        void limited.run('block', { to: 'U1' });
        void limited.run('block', { to: 'U2' });
        await jest.advanceTimersByTimeAsync(FIRST_RETRY_AFTER_SECONDS * 1000);
        blocked.get('U1')!();
        await whenBackgroundWorkIsDone();

        expect(started).toEqual(['U1']);
        expect(queue.deleteJob.mock.calls).toEqual([['block', 'job-1']]);
        expect(warn).toHaveBeenCalledWith(
          'Job block waited too long for a free slot: a worker runs its saved copy',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    const saved = (id: string, to: string) => ({
      id,
      data: { to },
      retryCount: 1,
      retryLimit: 8,
    });

    // pg-boss counts a fetched job's 15 minutes until it expires from the
    // fetch: a job must not wait for a slot after it.
    it('fetches no more saved jobs than there are free slots, and starts them at once', async () => {
      const limited = createJobs({ concurrency: 3 });
      limited.define('block', block);
      void limited.run('block', { to: 'U1' });
      await flush();

      queue.fetch.mockResolvedValueOnce([saved('j1', 'R1'), saved('j2', 'R2')]);
      const retries = limited.runDueJobs();
      await flush();

      expect(queue.fetch).toHaveBeenCalledWith('block', {
        batchSize: 2,
        includeMetadata: true,
      });
      expect(started).toEqual(['U1', 'R1', 'R2']);

      // The batch filled the free slots: there may be more, fetched as
      // slots free up.
      queue.fetch.mockResolvedValueOnce([saved('j3', 'R3')]);
      await end('R1');
      expect(queue.fetch).toHaveBeenLastCalledWith('block', {
        batchSize: 1,
        includeMetadata: true,
      });
      expect(started).toEqual(['U1', 'R1', 'R2', 'R3']);

      await end('U1');
      expect(queue.fetch).toHaveBeenCalledTimes(3);
      await end('R2');
      await end('R3');
      await retries;
      expect(queue.complete.mock.calls).toEqual([
        ['block', 'j1'],
        ['block', 'j2'],
        ['block', 'j3'],
      ]);
      expect(queue.fetch).toHaveBeenCalledTimes(3);
    });

    it('starts no poll while the last one still runs', async () => {
      jest.useFakeTimers();

      try {
        const polling = createJobs({ pollIntervalSeconds: 30 });
        polling.define('block', block);
        queue.fetch.mockResolvedValueOnce([saved('j1', 'R1')]);

        await jest.advanceTimersByTimeAsync(30_000);
        expect(started).toEqual(['R1']);

        await jest.advanceTimersByTimeAsync(60_000);
        expect(queue.fetch).toHaveBeenCalledTimes(1);

        blocked.get('R1')!();
        await jest.advanceTimersByTimeAsync(30_000);
        expect(queue.fetch).toHaveBeenCalledTimes(2);

        polling.onModuleDestroy();
      } finally {
        jest.useRealTimers();
      }
    });

    it('runs handlers as jobs, first runs and retries alike', async () => {
      const inJob: boolean[] = [];
      jobs.define('check', () => {
        inJob.push(isInJob());

        return Promise.resolve();
      });

      void jobs.run('check', {});
      await whenBackgroundWorkIsDone();
      queue.fetch
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'j1', data: {}, retryCount: 1, retryLimit: 8 },
        ]);
      await jobs.runDueJobs();

      expect(inJob).toEqual([true, true]);
      expect(isInJob()).toBe(false);
    });

    it('starts no waiting job once the app shuts down', async () => {
      const limited = createJobs({ concurrency: 1 });
      limited.define('block', block);

      void limited.run('block', { to: 'U1' });
      void limited.run('block', { to: 'U2' });
      await flush();
      await limited.onApplicationShutdown();
      await end('U1');
      await whenBackgroundWorkIsDone();

      expect(started).toEqual(['U1']);
    });
  });

  it('refuses a job nobody defined, and a second definition', () => {
    expect(() => jobs.run('ask', {})).toThrow('Job ask is not defined');
    expect(() => jobs.define('notify', () => Promise.resolve())).toThrow(
      'Job notify is defined twice',
    );
  });
});
