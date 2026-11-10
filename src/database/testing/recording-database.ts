import {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  QueryResult,
} from 'kysely';
import { SqlDatabase } from '@common/types/sql-database.types';
import { DatabaseService } from 'src/database/database.service';

// For unit tests: a Kysely that records the SQL of every query and answers
// them in turn, with rows or an error, without a database. `testing` folders
// stay out of the build.
export const recordingDatabase = (
  answers: (Record<string, unknown>[] | Error)[] = [],
) => {
  const queries: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery: <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
      queries.push(query);
      const answer = answers.shift() ?? [];

      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ rows: answer as R[] });
    },
    streamQuery: () => {
      throw new Error('not supported');
    },
  };
  const driver: Driver = {
    init: () => Promise.resolve(),
    acquireConnection: () => Promise.resolve(connection),
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  };
  const db = new Kysely<SqlDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  return {
    database: { db } as unknown as DatabaseService,
    queries,
    sqlOf: (index: number) => queries[index].sql,
    parametersOf: (index: number) => queries[index].parameters,
  };
};
