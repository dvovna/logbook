import { Logger } from '@nestjs/common';
import {
  BackgroundWorkShutdownService,
  SHUTDOWN_GRACE_MS,
} from '@common/services/background-work-shutdown.service';
import { runInBackground } from '@common/utils/run-in-background';

// Background work this test finishes when it wants to.
const startWork = () => {
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  runInBackground(new Logger('test'), 'do the work', () => done);

  return finish;
};

describe('BackgroundWorkShutdownService', () => {
  const service = new BackgroundWorkShutdownService();

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('lets the app close once the background work is done', async () => {
    const finish = startWork();
    let closed = false;

    const shutdown = service
      .beforeApplicationShutdown('SIGTERM')
      .then(() => (closed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);

    finish();
    await shutdown;
    expect(closed).toBe(true);
  });

  it('gives up after the grace period and says so', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const finish = startWork();

    const shutdown = service.beforeApplicationShutdown('SIGTERM');
    await jest.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    await shutdown;

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('background work still running'),
    );
    finish();
  });
});
