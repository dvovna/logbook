import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { SqlDatabase } from '@common/types/sql-database.types';
import { runInBackground } from '@common/utils/run-in-background';
import { POSTGREST_COMPATIBLE_TYPES } from 'src/database/pg-type-parsers';

interface ITransactionScope {
  trx: Kysely<SqlDatabase>;
  afterCommit: (() => Promise<unknown>)[];
  // Set once the transaction committed or rolled back. Work started inside it
  // that runs longer (background work inherits the async context) then uses
  // the pool instead of a connection that is no longer in a transaction.
  done: boolean;
}

// The app's own connections to Postgres (DATABASE_URL), for the repositories
// that moved off PostgREST. pg-boss keeps a pool of its own.
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);

  private readonly root: Kysely<SqlDatabase>;

  private readonly scopes = new AsyncLocalStorage<ITransactionScope>();

  public constructor(config: ConfigService) {
    const pool = new Pool({
      connectionString: config.getOrThrow<string>(
        EnvironmentVariable.DatabaseUrl,
      ),
      max: config.get<number>(EnvironmentVariable.DatabasePoolSize) ?? 5,
      application_name: 'logbook',
      types: POSTGREST_COMPATIBLE_TYPES,
    });

    this.root = new Kysely<SqlDatabase>({
      dialect: new PostgresDialect({
        pool,
        // Timestamps come back in UTC, as PostgREST gives them on Supabase.
        onCreateConnection: (connection) =>
          connection
            .executeQuery(CompiledQuery.raw("set time zone 'UTC'"))
            .then(() => undefined),
      }),
    });
  }

  // The current transaction when the caller runs inside transaction(), else
  // the pool. Repositories take it for every query, so a service makes
  // several repository calls atomic by wrapping them in transaction().
  public get db(): Kysely<SqlDatabase> {
    const scope = this.scopes.getStore();

    return scope && !scope.done ? scope.trx : this.root;
  }

  public get inTransaction(): boolean {
    const scope = this.scopes.getStore();

    return !!scope && !scope.done;
  }

  // Runs `work` in one transaction: it commits when `work` resolves and rolls
  // back when it throws. A transaction() inside another one joins it.
  public async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return work();
    }

    const scope: ITransactionScope = {
      trx: this.root,
      afterCommit: [],
      done: false,
    };
    let result: T;

    try {
      result = await this.root.transaction().execute((trx) => {
        scope.trx = trx;

        return this.scopes.run(scope, work);
      });
    } finally {
      scope.done = true;
    }

    for (const callback of scope.afterCommit) {
      runInBackground(this.logger, 'run work after a commit', callback);
    }

    return result;
  }

  // Runs `callback` once the current transaction has committed (never when it
  // rolls back), as background work; outside a transaction, at once. For
  // what must not happen before the data is visible to others: first runs of
  // jobs, events, Slack messages.
  public afterCommit(callback: () => Promise<unknown>) {
    const scope = this.scopes.getStore();

    if (scope && !scope.done) {
      scope.afterCommit.push(callback);

      return;
    }

    runInBackground(this.logger, 'run work after a commit', callback);
  }

  // Serializes the transactions that take the same key until they end, e.g.
  // the checks of a per-workspace limit and the insert after them.
  public async lock(key: string) {
    if (!this.inTransaction) {
      throw new Error(`lock(${key}) outside a transaction holds nothing`);
    }

    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
      this.db,
    );
  }

  // Runs another library's SQL (pg-boss's `db` option) on the current
  // transaction, or the pool.
  public sqlExecutor() {
    const db = this.db;

    return {
      executeSql: (text: string, values: unknown[]) =>
        db.executeQuery(CompiledQuery.raw(text, values)),
    };
  }

  public async onApplicationShutdown() {
    await this.root.destroy();
  }
}
