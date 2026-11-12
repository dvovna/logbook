export interface IEnqueueManyOptions {
  // At most this many first runs start in a second, e.g. to stay under
  // Slack's rate limits when the jobs message a whole workspace.
  perSecond?: number;
}

export type JobHandler<Payload> = (payload: Payload) => Promise<void>;

export interface IJobDefinitionOptions<Payload> {
  // Runs once the job won't be tried again (its last retry failed, or its
  // only run when it couldn't be saved), e.g. to tell the person who asked
  // for it. Its own failure is only logged.
  onGiveUp?: (payload: Payload) => Promise<void>;
}

export interface IEnqueueSingletonOptions<Payload> {
  // Does the first run instead of the defined handler: the same work, with
  // what the caller has at hand (e.g. a report it made for its answer).
  // Retries run the handler, from the payload alone.
  firstRun?: JobHandler<Payload>;
}

// A job's copy in pg-boss, for its retries.
export interface ISavedJob {
  id: string;
  // When a worker may take the copy (performance.now()).
  dueAt: number;
}
