// A job's copy in pg-boss, for its retries.
export interface ISavedJob {
  id: string;
  // When a worker may take the copy (performance.now()).
  dueAt: number;
}
