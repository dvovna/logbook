import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { SqlDatabase } from '@common/types/sql-database.types';
import { POSTGREST_COMPATIBLE_TYPES } from 'src/database/pg-type-parsers';
import { currentTransaction } from 'src/database/transaction-scope';

// Set on every connection of the pool, in one statement (a round trip each
// would cost a new connection two more):
// - timestamps come back in UTC, as PostgREST gives them on Supabase;
// - a stuck query, or a transaction someone forgot to end, can't hold one of
//   the few connections Supabase's session pooler allows.
export const SESSION_SETUP =
  "select set_config('TimeZone', 'UTC', false), " +
  "set_config('statement_timeout', '10s', false), " +
  "set_config('idle_in_transaction_session_timeout', '30s', false)";

// A new connection takes several round trips (TCP, TLS, authentication,
// SESSION_SETUP): most of a second when the database is in another region.
// The pool keeps an idle one this long (pg's default is 10 seconds), so that
// someone clicking through Slack reuses it. Under the idle timeouts of the
// load balancers on the way (AWS's is 350 seconds).
export const IDLE_CONNECTION_MS = 60_000;

// The app's own connections to Postgres (DATABASE_URL), for the repositories.
// pg-boss keeps a pool of its own. Services don't
// use this: they group repository calls with TransactionService.
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);

  private readonly root: Kysely<SqlDatabase>;

  public constructor(config: ConfigService) {
    const pool = new Pool({
      connectionString: config.getOrThrow<string>(
        EnvironmentVariable.DatabaseUrl,
      ),
      max: config.get<number>(EnvironmentVariable.DatabasePoolSize) ?? 10,
      // A query that can't get a connection in time fails, and the request
      // with it, instead of missing Slack's 3 seconds without a word.
      connectionTimeoutMillis: 2_000,
      application_name: 'logbook',
      types: POSTGREST_COMPATIBLE_TYPES,
      idleTimeoutMillis: IDLE_CONNECTION_MS,
      // TCP keepalive on an idle connection after 30 s (the OS waits 2
      // hours): a network that dropped it shows before a query needs it.
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
    });

    // An idle connection the server or the network closed: the pool drops
    // it and opens another when needed. Without a listener the error would
    // stop the process.
    pool.on('error', (error) =>
      this.logger.warn(`Idle database connection closed: ${error.message}`),
    );

    this.root = new Kysely<SqlDatabase>({
      dialect: new PostgresDialect({
        pool,
        onCreateConnection: async (connection) => {
          await connection.executeQuery(CompiledQuery.raw(SESSION_SETUP));
        },
      }),
    });
  }

  // The current transaction (TransactionService.transaction()) when there is
  // one, else the pool. Repositories take it for every query.
  public get db(): Kysely<SqlDatabase> {
    return currentTransaction()?.trx ?? this.root;
  }

  // For the health check.
  public async ping() {
    await sql`select 1`.execute(this.root);
  }

  public async onApplicationShutdown() {
    await this.root.destroy();
  }
}
