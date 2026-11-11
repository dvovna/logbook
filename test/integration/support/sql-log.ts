import { performance } from 'node:perf_hooks';
import { Client, Pool } from 'pg';
import { isBackgroundWork } from '@common/utils/run-in-background';
import { SESSION_SETUP } from 'src/database/database.service';

export interface ISqlStatement {
  text: string;
  // Run by background work (runInBackground, jobs, event listeners): nobody
  // waits for it before answering Slack.
  background: boolean;
  client: Client;
  // When the app sent it: for the first statement on a connection taken
  // from the pool, when it asked the pool for one (see askedAt).
  calledAt: number;
  // The first statement on a connection the pool handed out.
  fromPool: boolean;
  endedAt: number | null;
  // How many rows it returned; null until it came back, or when it failed.
  rows: number | null;
}

export interface ISqlCount {
  statements: number;
  // The longest chain of statements each sent after the one before it had
  // come back: what the answer waits for when every statement costs a round
  // trip. Statements run in parallel share one.
  roundTrips: number;
}

export interface ISqlLog {
  mark(): number;
  // Makes every statement come back `ms` later, as from a database far away,
  // for the rest of the test file: round trips then show clearly in the
  // timings. 0 turns it off.
  setLatency(ms: number): void;
  // What was sent after `since`: on the way to the answer (`answer`), and in
  // all, background work included (`all`). Call it after t.idle().
  count(since: number): { answer: ISqlCount; all: ISqlCount };
  statements(since: number): ISqlStatement[];
}

const log: ISqlStatement[] = [];
let installed = false;

// When the pool was asked for the connection, until its first statement.
// pg calls Client.query only once the pool hands a connection out. When the
// pool's connections are all in use (statements run at once, the app's
// background work: a job's first run, an event listener), a statement waits
// for one, and would seem sent after every statement that ended meanwhile,
// the one before it on that connection included: a round trip more,
// although it went out beside them. How often that happens depends on how
// fast the database answers, so on the other test files running at once.
const askedAt = new WeakMap<Client, number>();

// SQL_LATENCY_MS=100 makes every statement come back that much later, as on
// a laptop talking to a database in another region, and so does
// setLatency(). Off by default.
let latencyMs = Number(process.env.SQL_LATENCY_MS ?? 0);

// What every new connection runs first (DatabaseService): it depends on how
// warm the pool is, not on the action.
const isSessionSetting = (text: string) => text === SESSION_SETUP;

const later = <T>(value: T): Promise<T> =>
  latencyMs
    ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs))
    : Promise.resolve(value);

// The rows of a pg result (an array of them for several statements).
const rowsOf = (result: unknown): number | null => {
  const results = (Array.isArray(result) ? result : [result]) as {
    rows?: unknown[];
  }[];

  return results.some((one) => Array.isArray(one?.rows))
    ? results.reduce((sum, one) => sum + (one?.rows?.length ?? 0), 0)
    : null;
};

// Remembers when each connection was asked of a pool (pg-pool's connect,
// as a promise or with a callback).
const watchPools = () => {
  type Connect = (this: Pool, ...args: unknown[]) => unknown;
  const connect = Pool.prototype.connect as Connect;

  Pool.prototype.connect = function (this: Pool, ...args: unknown[]) {
    const asked = performance.now();
    const remember = (client: unknown) => {
      if (client) {
        askedAt.set(client as Client, asked);
      }
    };
    const callback = args[0];

    if (typeof callback === 'function') {
      return connect.call(
        this,
        (error: unknown, client: unknown, ...rest: unknown[]) => {
          remember(client);
          (callback as (...values: unknown[]) => void)(error, client, ...rest);
        },
      );
    }

    return (connect.call(this) as Promise<Client>).then((client) => {
      remember(client);

      return client;
    });
  } as typeof Pool.prototype.connect;
};

// Wraps pg's Client.query, which every statement of the app's pool, its
// transactions and pg-boss goes through, to keep a log of them.
const install = () => {
  if (installed) {
    return;
  }

  installed = true;
  watchPools();

  const query = Client.prototype.query as (...args: unknown[]) => unknown;

  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const config = args[0] as string | { text?: string };
    const text = typeof config === 'string' ? config : (config?.text ?? '');
    const statement: ISqlStatement = {
      text,
      background: isBackgroundWork(),
      client: this,
      calledAt: performance.now(),
      fromPool: false,
      endedAt: null,
      rows: null,
    };

    if (!isSessionSetting(text)) {
      const asked = askedAt.get(this);

      if (asked !== undefined) {
        statement.calledAt = asked;
        statement.fromPool = true;
        askedAt.delete(this);
      }

      log.push(statement);
    }

    const end = (result?: unknown) => {
      statement.endedAt = performance.now();
      statement.rows = rowsOf(result);
    };
    const callback = args[args.length - 1];

    // pg-pool's pool.query passes a callback.
    if (typeof callback === 'function') {
      args[args.length - 1] = (...results: unknown[]) =>
        void later(null).then(() => {
          end(results[1]);
          (callback as (...values: unknown[]) => void)(...results);
        });

      return query.apply(this, args);
    }

    const result = query.apply(this, args) as Promise<unknown> | undefined;

    if (!result || typeof result.then !== 'function') {
      return result;
    }

    return result.then(
      (value) =>
        later(value).then((delayed) => {
          end(delayed);

          return delayed;
        }),
      (error) =>
        later(null).then(() => {
          end();

          throw error;
        }),
    );
  } as typeof Client.prototype.query;
};

// The longest chain of statements where each was sent after another came
// back. A connection runs one statement at a time, so a statement waits for
// the one called before it on the same connection; but the first statement
// on a connection from the pool waits for nothing there: the statement
// before it was another caller's, which gave the connection back.
const roundTripsOf = (statements: ISqlStatement[]): number => {
  const sentAt = new Map<ISqlStatement, number>();
  const lastOnClient = new Map<Client, ISqlStatement>();

  for (const statement of log) {
    const before = statement.fromPool
      ? undefined
      : lastOnClient.get(statement.client);

    sentAt.set(
      statement,
      Math.max(statement.calledAt, before?.endedAt ?? statement.calledAt),
    );
    lastOnClient.set(statement.client, statement);
  }

  const ordered = [...statements].sort(
    (a, b) => sentAt.get(a)! - sentAt.get(b)!,
  );
  const depth = new Map<ISqlStatement, number>();

  for (const statement of ordered) {
    const sent = sentAt.get(statement)!;
    const before = ordered.filter(
      (other) =>
        other !== statement &&
        other.endedAt !== null &&
        other.endedAt <= sent &&
        depth.has(other),
    );

    depth.set(
      statement,
      1 + Math.max(0, ...before.map((other) => depth.get(other)!)),
    );
  }

  return Math.max(0, ...depth.values());
};

const countOf = (statements: ISqlStatement[]): ISqlCount => ({
  statements: statements.length,
  roundTrips: roundTripsOf(statements),
});

export const createSqlLog = (): ISqlLog => {
  install();

  return {
    mark: () => log.length,
    setLatency: (ms) => {
      latencyMs = ms;
    },
    statements: (since) => log.slice(since),
    count: (since) => {
      const statements = log.slice(since);

      return {
        answer: countOf(statements.filter(({ background }) => !background)),
        all: countOf(statements),
      };
    },
  };
};
