import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { SqlDatabase } from '@common/types/sql-database.types';
import { POSTGREST_COMPATIBLE_TYPES } from 'src/database/pg-type-parsers';
import { currentTransaction } from 'src/database/transaction-scope';

// Set on every connection of the pool:
// - timestamps come back in UTC, as PostgREST gives them on Supabase;
// - a stuck query, or a transaction someone forgot to end, can't hold one of
//   the few connections Supabase's session pooler allows.
export const SESSION_SETTINGS = [
  "set time zone 'UTC'",
  "set statement_timeout = '10s'",
  "set idle_in_transaction_session_timeout = '30s'",
];

// The app's own connections to Postgres (DATABASE_URL), for the repositories
// that moved off PostgREST. pg-boss keeps a pool of its own. Services don't
// use this: they group repository calls with TransactionService.
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly root: Kysely<SqlDatabase>;

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
        onCreateConnection: async (connection) => {
          for (const setting of SESSION_SETTINGS) {
            await connection.executeQuery(CompiledQuery.raw(setting));
          }
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
