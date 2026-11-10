import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { DatabaseService } from 'src/database/database.service';

// The app ships `supabase/migrations` (the Docker image copies it). From
// src/database or dist/database it is two levels up.
export const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
);

export const readShippedMigrations = (dir = MIGRATIONS_DIR): string[] =>
  readdirSync(dir)
    .map((file) => file.match(/^(\d{14})_.*\.sql$/)?.[1])
    .filter((version): version is string => !!version)
    .sort();

export const findMissingMigrations = (shipped: string[], applied: string[]) => {
  const appliedSet = new Set(applied);

  return shipped.filter((version) => !appliedSet.has(version));
};

// Refuses to start on a database that lacks migrations this version of the
// app ships: people who self-host update the app and forget
// `supabase db push`, and the app would otherwise fail later, on whatever
// column or function is missing, with an error that doesn't say why.
@Injectable()
export class MigrationsCheckService implements OnModuleInit {
  private readonly logger = new Logger(MigrationsCheckService.name);

  public constructor(private readonly database: DatabaseService) {}

  public async onModuleInit() {
    let shipped: string[];

    try {
      shipped = readShippedMigrations();
    } catch {
      this.logger.warn(
        `No migrations found in ${MIGRATIONS_DIR}; not checking the database`,
      );

      return;
    }

    const applied = await this.readAppliedMigrations();

    if (!applied) {
      this.logger.warn(
        'The database has no migration history; not checking it for missing migrations',
      );

      return;
    }

    const missing = findMissingMigrations(shipped, applied);

    if (missing.length === 0) {
      return;
    }

    const message =
      `The database lacks ${missing.length} migration(s) this version needs: ` +
      `${missing.join(', ')}. ` +
      'Apply them with `pnpm supabase db push --remote "<connection string>"` ' +
      '(locally `pnpm supabase migration up`), then start the app again.';

    this.logger.error(message);
    throw new Error(message);
  }

  // The versions the Supabase CLI recorded, or null when the database has no
  // such history (e.g. the schema was applied by hand).
  private async readAppliedMigrations(): Promise<string[] | null> {
    const db = this.database.db;

    try {
      const { rows: history } = await sql<{ present: boolean }>`
        select to_regclass('supabase_migrations.schema_migrations') is not null as present
      `.execute(db);

      if (!history[0]?.present) {
        return null;
      }

      const { rows } = await sql<{ version: string }>`
        select version from supabase_migrations.schema_migrations
      `.execute(db);

      return rows.map(({ version }) => version);
    } catch (error) {
      throw Object.assign(
        new Error(
          `Failed to read the applied migrations: ${(error as Error).message}`,
        ),
        { cause: error },
      );
    }
  }
}
