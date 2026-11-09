import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_JOBS_OPTIONS, JobsService } from '@common/jobs/jobs.service';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';
import * as errorReporter from '@common/errors/error-reporter';
import { DatabaseService } from 'src/database/database.service';

// Without DATABASE_URL: the integration tests cover the queue in Postgres.
describe('JobsService without a database', () => {
  let jobs: JobsService;
  let error: jest.SpyInstance;
  // A transaction that has not committed yet: what it runs after the commit.
  let database: { inTransaction: boolean; afterCommit: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    database = { inTransaction: true, afterCommit: jest.fn() };
    jobs = new JobsService(
      { get: () => undefined } as unknown as ConfigService,
      DEFAULT_JOBS_OPTIONS,
      database as unknown as DatabaseService,
    );
    jobs.onApplicationBootstrap();
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs a job at once, as background work', async () => {
    const sent: string[] = [];
    jobs.define<{ to: string }>('notify', async ({ to }) => {
      await Promise.resolve();
      sent.push(to);
    });

    jobs.run('notify', { to: 'U1' });
    expect(sent).toEqual([]);

    await whenBackgroundWorkIsDone();
    expect(sent).toEqual(['U1']);
  });

  it('logs a failed job, which is not retried', async () => {
    jobs.define('notify', () => Promise.reject(new Error('Slack is down')));

    jobs.run('notify', {});
    await whenBackgroundWorkIsDone();

    expect(error).toHaveBeenCalledWith(
      'Job notify failed: Slack is down',
      expect.any(String),
    );
  });

  it('reports a job that failed its only run to error tracking', async () => {
    const report = jest.spyOn(errorReporter, 'reportError');
    jobs.define('notify', () => Promise.reject(new Error('Slack is down')));

    jobs.run('notify', {});
    await whenBackgroundWorkIsDone();

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Slack is down' }),
      { job: 'notify' },
    );
  });

  it('runs a job enqueued in a transaction only after the commit', async () => {
    const sent: string[] = [];
    jobs.define<{ to: string }>('notify', ({ to }) => {
      sent.push(to);

      return Promise.resolve();
    });

    await jobs.enqueue('notify', { to: 'U1' });
    await whenBackgroundWorkIsDone();
    expect(sent).toEqual([]);

    const [[commit]] = database.afterCommit.mock.calls as [
      [() => Promise<void>],
    ];
    await commit();
    expect(sent).toEqual(['U1']);
  });

  it('refuses to enqueue a job outside a transaction', async () => {
    jobs.define('notify', () => Promise.resolve());
    database.inTransaction = false;

    await expect(jobs.enqueue('notify', {})).rejects.toThrow(
      'Job notify enqueued outside a transaction: use run()',
    );
  });

  it('refuses a job nobody defined, and a second definition', () => {
    jobs.define('notify', () => Promise.resolve());

    expect(() => jobs.run('ask', {})).toThrow('Job ask is not defined');
    expect(() => jobs.define('notify', () => Promise.resolve())).toThrow(
      'Job notify is defined twice',
    );
  });
});
