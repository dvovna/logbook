import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { assertLocalUrl } from './local-url';

const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
);

// Reads the URLs of the running local stack from the Supabase CLI.
const readLocalStackEnv = (): Record<string, string> => {
  let output: string;

  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      'The local Supabase stack is not running. Start it with `pnpm supabase start`.',
    );
  }

  return Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((match): match is RegExpMatchArray => !!match)
      .map(([, name, value]) => [name, value]),
  );
};

// The app expects the schema from supabase/migrations. A local database that
// was created before the latest migration fails in confusing ways, so check
// that every migration is applied before running anything.
const assertMigrationsApplied = async (dbUrl: string) => {
  const expected = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.split('_')[0]);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const { rows } = await client.query<{ version: string }>(
      'select version from supabase_migrations.schema_migrations',
    );
    const applied = new Set(rows.map(({ version }) => version));
    const missing = expected.filter((version) => !applied.has(version));

    if (missing.length) {
      throw new Error(
        `The local database is missing migrations ${missing.join(', ')}. ` +
          'Apply them with `pnpm supabase migration up` ' +
          '(or recreate the database with `pnpm db:init`).',
      );
    }
  } finally {
    await client.end();
  }
};

export default async function globalSetup() {
  process.env.SUPABASE_DB_URL ??= readLocalStackEnv().DB_URL;

  // The tests create and delete workspaces; never let them near a real project.
  assertLocalUrl('SUPABASE_DB_URL', process.env.SUPABASE_DB_URL);

  await assertMigrationsApplied(process.env.SUPABASE_DB_URL!);
}
