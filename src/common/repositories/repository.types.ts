import { ISearchParams, ISearchResult } from '@common/types/pagination.types';

// What both repository implementations share: the filters the services build,
// the workspace checks, and the public methods. BaseRepository runs them over
// PostgREST, SqlRepository over a direct Postgres connection.

type FilterSimpleValue = string | number | boolean | null | string[] | number[];

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'is'
  | 'not.is'
  | 'lt'
  | 'lte'
  | 'in'
  | 'like'
  | 'ilike'
  | 'cs'
  | 'cd'
  | 'ov';

export interface IFilterParams {
  operator: FilterOperator;
  value: FilterSimpleValue;
}

// Column → value (`=`), list of values (`in`), or operator and value. An
// undefined value is left out; an empty list matches no row.
export type RepositoryFilter = Record<
  string,
  FilterSimpleValue | undefined | IFilterParams | IFilterParams[]
>;

export interface IQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string[];
}

export interface IRepository<Insert, Update, ViewModel> {
  findOne(filter: RepositoryFilter): Promise<ViewModel | null>;
  findMany(
    filter: RepositoryFilter,
    options?: IQueryOptions,
  ): Promise<ViewModel[]>;
  search(
    params: ISearchParams<RepositoryFilter>,
  ): Promise<ISearchResult<ViewModel>>;
  count(filter: RepositoryFilter): Promise<number>;
  create(data: Insert): Promise<ViewModel>;
  createMany(data: Insert[]): Promise<ViewModel[]>;
  update(filter: RepositoryFilter, data: Update): Promise<ViewModel>;
  updateMany(filter: RepositoryFilter, data: Update): Promise<ViewModel[]>;
  upsert(
    data: Insert | Insert[],
    onConflict?: string | string[],
  ): Promise<ViewModel | ViewModel[]>;
  deleteMany(filter: RepositoryFilter): Promise<number>;
}

export const isFilterParams = (value: unknown): value is IFilterParams =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  'operator' in value &&
  'value' in value;

// Every query and insert on a workspace's table must name the workspace: a
// filter value that is undefined is left out of the query, so a missing ID
// would otherwise read or change other workspaces' rows. `workspaceColumn` is
// null only for slack_teams itself, where any filter at all is required.
export const assertScoped = (
  tableName: string,
  workspaceColumn: string | null,
  filter: RepositoryFilter,
  operation: string,
) => {
  const hasCondition = Object.values(filter).some(
    (value) => value !== undefined,
  );

  if (!hasCondition) {
    throw new Error(`[${tableName}] ${operation} without a filter`);
  }

  if (workspaceColumn && !filter[workspaceColumn]) {
    throw new Error(`[${tableName}] ${operation} without ${workspaceColumn}`);
  }
};

export const assertRowsScoped = (
  tableName: string,
  workspaceColumn: string | null,
  rows: object[],
  operation: string,
) => {
  if (
    workspaceColumn &&
    rows.some((row) => !(row as Record<string, unknown>)[workspaceColumn])
  ) {
    throw new Error(`[${tableName}] ${operation} without ${workspaceColumn}`);
  }
};
