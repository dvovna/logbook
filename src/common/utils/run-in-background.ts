import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { reportError } from '@common/errors/error-reporter';

// Background work started and not finished yet.
const pending = new Set<Promise<unknown>>();

// Set inside the work startInBackground() starts, and in whatever it awaits:
// nobody waits for that work before answering. The integration tests use it
// to count the queries on the way to an answer apart from those after it.
const backgroundWork = new AsyncLocalStorage<true>();

export const isBackgroundWork = () => backgroundWork.getStore() === true;

// Slack waits 3 seconds for the answer to an interaction, then shows it as
// failed. Work that can take longer (several queries and Slack calls) runs
// after the answer. Nobody awaits it, so its errors are logged here instead
// of becoming an unhandled rejection that would stop the process.
export const runInBackground = (
  logger: Logger,
  description: string,
  task: () => Promise<unknown>,
) => {
  startInBackground(() =>
    task().catch((error: Error) => {
      logger.error(`Failed to ${description}: ${error.message}`, error.stack);
      reportError(error, { task: description });
    }),
  );
};

// Starts `task`, which handles its own errors, as background work and
// returns its promise.
export const startInBackground = <T>(task: () => Promise<T>): Promise<T> => {
  const work = backgroundWork.run(true, task);

  trackInBackground(work);

  return work;
};

// Counts a promise that handles its own errors as background work.
export const trackInBackground = (work: Promise<unknown>) => {
  const tracked = work.finally(() => pending.delete(tracked));

  pending.add(tracked);
};

// Resolves once no background work is left, including work started by the
// work it waited for. The integration tests wait for it instead of polling.
export const whenBackgroundWorkIsDone = async () => {
  while (pending.size) {
    await Promise.allSettled([...pending]);
  }
};
