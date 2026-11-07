import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SupabaseService } from 'src/database/supabase.service';
import { RpcFunctionName } from '@common/enums/rpc-function-name';

// The app ships `supabase/migrations` (the Docker image copies it). From
// src/database or dist/database it is two levels up.
export const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
);

// The migration that adds applied_migrations(): a database without the
// function lacks at least this one.
export const APPLIED_MIGRATIONS_VERSION = '20261107150000';

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

  public constructor(private readonly supabase: SupabaseService) {}

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

    if (applied === 'unknown') {
      this.logger.warn(
        'The database has no migration history; not checking it for missing migrations',
      );

      return;
    }

    const missing =
      applied === 'none-known'
        ? shipped.filter((version) => version >= APPLIED_MIGRATIONS_VERSION)
        : findMissingMigrations(shipped, applied);

    if (missing.length === 0) {
      return;
    }

    const message =
      `The database lacks ${missing.length} migration(s) this version needs: ` +
      `${missing.join(', ')}${applied === 'none-known' ? ' and possibly older ones' : ''}. ` +
      'Apply them with `yarn supabase db push --remote "<connection string>"` ' +
      '(locally `yarn supabase migration up`), then start the app again.';

    this.logger.error(message);
    throw new Error(message);
  }

  // The applied versions; 'none-known' when the database is older than
  // applied_migrations() itself, 'unknown' when it has no migration history.
  private async readAppliedMigrations(): Promise<
    string[] | 'none-known' | 'unknown'
  > {
    const { data, error } = await this.supabase
      .getClient()
      .rpc(RpcFunctionName.AppliedMigrations);

    if (error) {
      // PostgREST: no such function in the schema cache.
      if (error.code === 'PGRST202') {
        return 'none-known';
      }

      throw new Error(
        `Failed to read the applied migrations: ${error.message}`,
      );
    }

    return data ?? 'unknown';
  }
}
