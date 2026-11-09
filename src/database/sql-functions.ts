import { Kysely, sql } from 'kysely';
import { Database } from '@common/types/database.types';
import { SqlDatabase } from '@common/types/sql-database.types';

type Functions = Database['public']['Functions'];

export type SqlFunctionName = keyof Functions & string;

// Calls one of the app's SQL functions (supabase/migrations) over the direct
// connection and returns its rows, typed as `yarn db:types` generated them.
// Arguments go by name; an undefined one takes the function's default, as it
// did through PostgREST. A jsonb argument goes in as JSON text
// (JSON.stringify): node-postgres would send an array as a Postgres array.
export const callFunction = async <Name extends SqlFunctionName>(
  db: Kysely<SqlDatabase>,
  name: Name,
  args: Functions[Name]['Args'],
): Promise<Functions[Name]['Returns']> => {
  const named = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([arg, value]) => sql`${sql.ref(arg)} => ${value}`);

  try {
    const { rows } = await sql`select * from ${sql.ref(name)}(${sql.join(
      named,
    )})`.execute(db);

    return rows as Functions[Name]['Returns'];
  } catch (error) {
    throw Object.assign(
      new Error(`${name} failed: ${(error as Error).message}`),
      { cause: error },
    );
  }
};
