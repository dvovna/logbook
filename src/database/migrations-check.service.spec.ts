import { Logger } from '@nestjs/common';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findMissingMigrations,
  MigrationsCheckService,
  readShippedMigrations,
} from 'src/database/migrations-check.service';
import { recordingDatabase } from 'src/database/testing/recording-database';

// A database whose migration history holds `applied`, or that has none.
const checkWith = (applied: string[] | null) =>
  new MigrationsCheckService(
    recordingDatabase(
      applied
        ? [[{ present: true }], applied.map((version) => ({ version }))]
        : [[{ present: false }]],
    ).database,
  );

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
  });

  it('finds the shipped migrations the database lacks', () => {
    expect(findMissingMigrations(['1', '2', '3'], ['1', '3', '9'])).toEqual([
      '2',
    ]);
  });

  it('lets the app start when every migration is applied', async () => {
    await expect(checkWith(shipped).onModuleInit()).resolves.toBeUndefined();
  });

  it('refuses to start and names the missing migrations', async () => {
    await expect(
      checkWith(shipped.slice(0, -2)).onModuleInit(),
    ).rejects.toThrow(
      `lacks 2 migration(s) this version needs: ${shipped.slice(-2).join(', ')}.`,
    );
  });

  it('only warns when the database has no migration history', async () => {
    await expect(checkWith(null).onModuleInit()).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('no migration history'),
    );
  });

  it('says why it could not read the history', async () => {
    const { database } = recordingDatabase([
      new Error('permission denied for schema'),
    ]);

    await expect(
      new MigrationsCheckService(database).onModuleInit(),
    ).rejects.toThrow(
      'Failed to read the applied migrations: permission denied for schema',
    );
  });
});
