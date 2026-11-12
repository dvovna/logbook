import {
  findMissingMigrations,
  readShippedMigrations,
} from 'src/database/migrations-check.service';
import { ICheckResult } from 'src/checkup/check.types';

// Runs one statement and gives its rows.
export type Query = (sql: string) => Promise<Record<string, unknown>[]>;

// Over this a click of ten statements spends a noticeable part of Slack's 3
// seconds on the way to the database alone.
const SLOW_ROUND_TRIP_MS = 20;
const ROUND_TRIPS = 5;

const API_ROLES = "('anon', 'authenticated')";

const names = (rows: Record<string, unknown>[], column: string) =>
  [...new Set(rows.map((row) => String(row[column])))].slice(0, 5).join(', ');

async function checkMigrations(query: Query): Promise<ICheckResult> {
  const name = 'Migrations';
  let shipped: string[];

  try {
    shipped = readShippedMigrations();
  } catch {
    return { name, status: 'skip', detail: 'no supabase/migrations here' };
  }

  const [{ present }] = await query(
    "select to_regclass('supabase_migrations.schema_migrations') is not null as present",
  );

  if (!present) {
    return {
      name,
      status: 'fail',
      detail: 'the database has no migration history',
      fix: 'Apply the migrations: pnpm supabase db push --remote "<connection string>"',
    };
  }

  const applied = await query(
    'select version from supabase_migrations.schema_migrations',
  );
  const missing = findMissingMigrations(
    shipped,
    applied.map(({ version }) => String(version)),
  );

  return missing.length
    ? {
        name,
        status: 'fail',
        detail: `${missing.length} of this release's are not applied: ${missing.join(', ')}`,
        fix: 'Apply them before the new version starts: pnpm supabase db push --remote "<connection string>"',
      }
    : {
        name,
        status: 'ok',
        detail: `all ${shipped.length} of this release are applied`,
      };
}

// The app reaches its tables as their owner; Supabase's API roles get
// nothing (the three queries of the Update guide).
async function checkApiAccess(query: Query): Promise<ICheckResult> {
  const name = 'API access';
  const roles = await query(
    `select rolname from pg_roles where rolname in ${API_ROLES}`,
  );

  if (!roles.length) {
    return { name, status: 'skip', detail: 'no Supabase API roles here' };
  }

  const open = [
    {
      what: 'tables without row-level security',
      rows: await query(
        "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity",
      ),
      column: 'relname',
    },
    {
      what: 'tables the API roles may read or write',
      rows: await query(
        "select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')",
      ),
      column: 'table_name',
    },
    {
      what: 'functions the API roles may run',
      rows: await query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (${roles
          .map(
            ({ rolname }) =>
              `has_function_privilege('${String(rolname)}', p.oid, 'execute')`,
          )
          .join(' or ')})`,
      ),
      column: 'proname',
    },
  ].filter(({ rows }) => rows.length);

  return open.length
    ? {
        name,
        status: 'fail',
        detail: open
          .map(({ what, rows, column }) => `${what}: ${names(rows, column)}`)
          .join('; '),
        fix: 'Something changed the schema outside the migrations: turn row-level security on and revoke the API roles\' grants (Update guide, "Check that the database is closed")',
      }
    : {
        name,
        status: 'ok',
        detail: "the API roles reach none of Logbook's tables or functions",
      };
}

async function checkLatency(
  query: Query,
  now: () => number,
): Promise<ICheckResult> {
  const times: number[] = [];

  for (let trip = 0; trip < ROUND_TRIPS; trip++) {
    const start = now();
    await query('select 1');
    times.push(now() - start);
  }

  const median = Math.round(times.sort((a, b) => a - b)[2]);

  return median > SLOW_ROUND_TRIP_MS
    ? {
        name: 'Round trip to the database',
        status: 'warn',
        detail: `${median} ms`,
        fix: "Run Logbook in the database's region: a click sends up to ten statements one after another before Slack's 3 seconds run out",
      }
    : {
        name: 'Round trip to the database',
        status: 'ok',
        detail: `${median} ms`,
      };
}

// `connect` opens the connection and gives a way to query and to close it.
export async function checkDatabase(
  connect: () => Promise<{ query: Query; close: () => Promise<void> }>,
  now: () => number = () => performance.now(),
): Promise<ICheckResult[]> {
  let connection: Awaited<ReturnType<typeof connect>>;

  try {
    connection = await connect();
  } catch (error) {
    return [
      {
        name: 'Database',
        status: 'fail',
        detail: `can't connect: ${(error as Error).message}`,
        fix: 'Check DATABASE_URL: the session pooler connection string, with the database password, reachable from this machine (the direct db.<ref>.supabase.co host is IPv6-only)',
      },
    ];
  }

  try {
    return [
      { name: 'Database', status: 'ok', detail: 'connected' },
      await checkMigrations(connection.query),
      await checkApiAccess(connection.query),
      await checkLatency(connection.query, now),
    ];
  } finally {
    await connection.close();
  }
}
