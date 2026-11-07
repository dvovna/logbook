import { Logger } from '@nestjs/common';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPLIED_MIGRATIONS_VERSION,
  findMissingMigrations,
  MigrationsCheckService,
  readShippedMigrations,
} from 'src/database/migrations-check.service';
import { SupabaseService } from 'src/database/supabase.service';

const answer = (result: { data?: unknown; error?: unknown }) =>
  ({
    getClient: () => ({
      rpc: jest.fn().mockResolvedValue({ data: null, error: null, ...result }),
    }),
  }) as unknown as SupabaseService;

describe('MigrationsCheckService', () => {
  const shipped = readShippedMigrations();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads the versions of the shipped migrations, in order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    for (const file of [
      '20260201000000_b.sql',
      '20260101000000_a.sql',
      'README.md',
    ]) {
      writeFileSync(join(dir, file), '');
    }

    expect(readShippedMigrations(dir)).toEqual([
      '20260101000000',
      '20260201000000',
    ]);
    expect(shipped).toContain(APPLIED_MIGRATIONS_VERSION);
  });

  it('finds the shipped migrations the database lacks', () => {
    expect(findMissingMigrations(['1', '2', '3'], ['1', '3', '9'])).toEqual([
      '2',
    ]);
  });

  it('lets the app start when every migration is applied', async () => {
    const service = new MigrationsCheckService(answer({ data: shipped }));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('refuses to start and names the missing migrations', async () => {
    const service = new MigrationsCheckService(
      answer({ data: shipped.slice(0, -2) }),
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      `lacks 2 migration(s) this version needs: ${shipped.slice(-2).join(', ')}.`,
    );
  });

  it('refuses to start on a database older than the check itself', async () => {
    const service = new MigrationsCheckService(
      answer({ error: { code: 'PGRST202', message: 'Could not find' } }),
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      `${APPLIED_MIGRATIONS_VERSION}`,
    );
    await expect(service.onModuleInit()).rejects.toThrow(
      'and possibly older ones',
    );
  });

  it('only warns when the database has no migration history', async () => {
    const service = new MigrationsCheckService(answer({ data: null }));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('no migration history'),
    );
  });
});
