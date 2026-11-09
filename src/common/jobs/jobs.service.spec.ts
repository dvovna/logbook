import { Logger } from '@nestjs/common';
import {
  DEFAULT_JOBS_OPTIONS,
  FIRST_RETRY_AFTER_SECONDS,
  JobQueue,
  JobsService,
} from '@common/jobs/jobs.service';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';
import * as errorReporter from '@common/errors/error-reporter';
import { TransactionService } from 'src/database/transaction.service';

// pg-boss without Postgres: it saves nothing and answers with job IDs. The
// integration tests cover the queue in Postgres (job-retries.int-spec.ts).
const fakeQueue = () => {
  let saved = 0;

  return {
    send: jest.fn(() => Promise.resolve(`job-${(saved += 1)}`)),
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
    transactions = {
      inTransaction: false,
      afterCommit: jest.fn(),
      sqlExecutor: () => executor,
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

  it('runs a job enqueued outside a transaction at once, as run() does', async () => {
    await jobs.enqueue('notify', { to: 'U1' });
    await whenBackgroundWorkIsDone();

    expect(sent).toEqual(['U1']);
    expect(queue.send).toHaveBeenCalledWith(
      'notify',
      { to: 'U1' },
      { startAfter: FIRST_RETRY_AFTER_SECONDS },
    );
    expect(transactions.afterCommit).not.toHaveBeenCalled();
  });

  it('refuses a job nobody defined, and a second definition', () => {
    expect(() => jobs.run('ask', {})).toThrow('Job ask is not defined');
    expect(() => jobs.define('notify', () => Promise.resolve())).toThrow(
      'Job notify is defined twice',
    );
  });
});
