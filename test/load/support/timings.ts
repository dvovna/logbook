import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Pool } from 'pg';

export interface IPercentiles {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

// Nearest-rank percentiles, in whole milliseconds.
export const percentiles = (values: number[]): IPercentiles => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length
      ? Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)])
      : 0;

  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
};

// Runs `task` for every item, at most `limit` at once.
export const forEachAtMost = async <T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
) => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;

      next += 1;
      await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface IPoolWaits {
  // How long each connection the app asked its pool for took to come, in ms.
  waits: number[];
  // Asked for and not given within the pool's connectionTimeoutMillis.
  timeouts: number;
  stop(): void;
}

// How long the app's queries wait for one of its pool's connections
// (DatabaseService's pool, application_name `logbook`; pg-boss has its own):
// the queue that forms when the pool is too small for the load.
export const watchPoolWaits = (): IPoolWaits => {
  type Connect = (this: Pool, ...args: unknown[]) => unknown;
  const connect = Pool.prototype.connect as Connect;
  const result: IPoolWaits = {
    waits: [],
    timeouts: 0,
    stop: () => {
      Pool.prototype.connect = connect as typeof Pool.prototype.connect;
    },
  };
  const isAppPool = (pool: Pool) =>
    (pool as unknown as { options: { application_name?: string } }).options
      .application_name === 'logbook';
  const done = (pool: Pool, asked: number, error: unknown) => {
    if (!isAppPool(pool)) {
      return;
    }

    if (error) {
      result.timeouts += 1;
    } else {
      result.waits.push(performance.now() - asked);
    }
  };

  Pool.prototype.connect = function (this: Pool, ...args: unknown[]) {
    const asked = performance.now();
    const callback = args[0];

    if (typeof callback === 'function') {
      return connect.call(this, (error: unknown, ...rest: unknown[]) => {
        done(this, asked, error);
        (callback as (...values: unknown[]) => void)(error, ...rest);
      });
    }

    return (connect.call(this) as Promise<unknown>).then(
      (client) => {
        done(this, asked, null);

        return client;
      },
      (error: unknown) => {
        done(this, asked, error);

        throw error;
      },
    );
  } as typeof Pool.prototype.connect;

  return result;
};

// How late Node's event loop ran: the app, the test client and the fake
// Slack share one process, so time spent on the CPU shows here, apart from
// time spent waiting for Postgres.
export const watchEventLoop = () => {
  const histogram = monitorEventLoopDelay({ resolution: 10 });

  histogram.enable();

  return () => {
    histogram.disable();

    const ms = (ns: number) => Math.round(ns / 1e6);

    return {
      p50: ms(histogram.percentile(50)),
      p99: ms(histogram.percentile(99)),
      max: ms(histogram.max),
    };
  };
};
