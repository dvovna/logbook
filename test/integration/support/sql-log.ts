import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { isBackgroundWork } from '@common/utils/run-in-background';
import { SESSION_SETUP } from 'src/database/database.service';

// One statement the app (or pg-boss) sent to Postgres.
export interface ISqlStatement {
  text: string;
  // Run by background work (runInBackground, jobs, event listeners): nobody
  // waits for it before answering Slack.
  background: boolean;
  client: Client;
  calledAt: number;
  endedAt: number | null;
}

export interface ISqlCount {
  statements: number;
  // The longest chain of statements each sent after the one before it had
  // come back: what the answer waits for when every statement costs a round
  // trip. Statements run in parallel share one.
  roundTrips: number;
}

export interface ISqlLog {
  // The position in the log now, for count() and statements().
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

// Wraps pg's Client.query, which every statement of the app's pool, its
// transactions and pg-boss goes through, to keep a log of them.
const install = () => {
  if (installed) {
    return;
  }

  installed = true;

  const query = Client.prototype.query as (...args: unknown[]) => unknown;

  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const config = args[0] as string | { text?: string };
    const text = typeof config === 'string' ? config : (config?.text ?? '');
    const statement: ISqlStatement = {
      text,
      background: isBackgroundWork(),
      client: this,
      calledAt: performance.now(),
      endedAt: null,
    };

    if (!isSessionSetting(text)) {
      log.push(statement);
    }

    const end = () => {
      statement.endedAt = performance.now();
    };
    const callback = args[args.length - 1];

    // pg-pool's pool.query passes a callback.
    if (typeof callback === 'function') {
      args[args.length - 1] = (...results: unknown[]) =>
        void later(null).then(() => {
          end();
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
          end();

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
// the one called before it on the same connection.
const roundTripsOf = (statements: ISqlStatement[]): number => {
  const sentAt = new Map<ISqlStatement, number>();
  const lastOnClient = new Map<Client, ISqlStatement>();

  for (const statement of log) {
    const before = lastOnClient.get(statement.client);

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
