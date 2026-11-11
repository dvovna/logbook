export interface IEnqueueManyOptions {
  // At most this many first runs start in a second, e.g. to stay under
  // Slack's rate limits when the jobs message a whole workspace.
  perSecond?: number;
}

// A job's copy in pg-boss, for its retries.
export interface ISavedJob {
  id: string;
  // When a worker may take the copy (performance.now()).
  dueAt: number;
}
