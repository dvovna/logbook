import { sql } from 'kysely';
import { createTestApp, ITestApp } from './support/test-app';

// Rules for every table, checked on the local database with all migrations.
describe('Schema', () => {
  let t: ITestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  // Deleting or nulling a referenced row looks up the rows that point at it,
  // once per row. Without an index that starts with the foreign key's
  // columns that lookup reads every workspace's rows, and deleting a
  // workspace (a cascade through all its users, projects and teams) runs
  // past the statement timeout. A partial index serves the lookup only when
  // it leaves out nothing but nulls.
  it('has an index that starts with the columns of every foreign key', async () => {
    const { rows } = await sql<{ foreign_key: string }>`
      select c.conrelid::regclass || '.' || c.conname as foreign_key
      from pg_constraint c
      where c.contype = 'f'
        and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1
          from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]
                @> c.conkey::int2[]
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]
                <@ c.conkey::int2[]
            and (
              i.indpred is null
              or pg_get_expr(i.indpred, i.indrelid) = (
                select '(' || string_agg(
                  quote_ident(a.attname) || ' IS NOT NULL', ' AND '
                ) || ')'
                from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any (c.conkey)
              )
            )
        )
      order by 1
    `.execute(t.db);

    expect(rows.map(({ foreign_key }) => foreign_key)).toEqual([]);
  });
});
