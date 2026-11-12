import { AsyncLocalStorage } from 'node:async_hooks';

// Set while a job's handler runs (JobsService), and in whatever it awaits:
// nobody looks at the outcome before it is over, so a Slack call made there
// may wait out more rate limits than one a person waits for.
const jobRuns = new AsyncLocalStorage<true>();

export const runAsJob = <T>(task: () => Promise<T>): Promise<T> =>
  jobRuns.run(true, task);

export const isInJob = () => jobRuns.getStore() === true;
