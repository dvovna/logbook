import { Injectable } from '@nestjs/common';
import {
  DeleteQueryBuilder,
  DeleteResult,
  Expression,
  ExpressionBuilder,
  InsertQueryBuilder,
  Kysely,
  SelectQueryBuilder,
  sql,
  SqlBool,
  UpdateQueryBuilder,
  UpdateResult,
} from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { DatabaseService } from 'src/database/database.service';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import {
  SqlDatabase,
  SqlInsert,
  SqlRow,
  SqlTableName,
  SqlUpdate,
} from '@common/types/sql-database.types';
import {
  assertRowsScoped,
  assertScoped,
  FilterOperator,
  IFilterParams,
  IQueryOptions,
  IRepository,
  isFilterParams,
  RepositoryFilter,
} from '@common/repositories/repository.types';

// The generic methods build queries from column names they get at run time
// (filters, orders), which Kysely can't check, so they use this untyped view
// of the database. Their signatures are typed by the table, and the queries a
// subclass writes itself go through `this.db`, which is typed throughout.
type AnyDatabase = Record<string, Record<string, unknown>>;
type AnyExpressions = ExpressionBuilder<AnyDatabase, string>;
type AnyRow = Record<string, unknown>;
type AnySelect = SelectQueryBuilder<AnyDatabase, string, AnyRow>;

// A many-to-one relation, embedded in each row as an object (or null) under
// its key, as PostgREST's `alias:fk_column ( columns )` does.
export interface IRelation {
  table: SqlTableName;
  foreignKey: string;
  columns: string[];
}

const OPERATORS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
  is: 'is',
  'not.is': 'is not',
  cs: '@>',
  cd: '<@',
  ov: '&&',
} as const satisfies Record<Exclude<FilterOperator, 'in'>, string>;

const ARRAY_OPERATORS = new Set<FilterOperator>(['cs', 'cd', 'ov']);

// `%`, `_` and `\` in a search term are text, not LIKE wildcards.
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

// The generic methods of every repository, over the app's Postgres connection
// (DatabaseService), with the workspace checks. A query returns every row it
// matches (PostgREST stopped at 1000), and inside
// TransactionService.transaction() every method takes part in the transaction.
@Injectable()
export abstract class BaseRepository<
  Table extends SqlTableName,
  ViewModel,
> implements IRepository<SqlInsert<Table>, SqlUpdate<Table>, ViewModel> {
  protected abstract readonly tableName: Table;

  protected relations: Record<string, IRelation> | null = null;

  protected readonly defaultPageLimit = 10;

  protected searchableColumns: string[] = [];

  protected defaultOrderBy: string[] = ['created_at:desc'];

  // Columns that tell any two rows apart. They end every order, so that pages
  // of one result neither skip nor repeat rows that sort the same.
  protected readonly uniqueOrder: string[] = ['id:asc'];

  // See assertScoped(): null only for slack_teams itself.
  protected readonly workspaceColumn: string | null = 'slack_team_id';

  public constructor(protected readonly database: DatabaseService) {}

  protected abstract mapToViewModel: (row: SqlRow<Table>) => ViewModel;

  // Typed queries; the current transaction's when there is one.
  protected get db(): Kysely<SqlDatabase> {
    return this.database.db;
  }

  public async findOne(filter: RepositoryFilter): Promise<ViewModel | null> {
    this.assertScoped(filter, 'findOne');

    // No row is null; several rows are an error, not "the first one". Two
    // rows are enough to tell "several" apart.
    const rows = await this.run('findOne', () =>
      this.select(filter).limit(2).execute(),
    );

    if (rows.length > 1) {
      throw new Error(
        `[${this.tableName}] findOne error: the filter matches several rows`,
      );
    }

    return rows.length ? this.toViewModel(rows[0]) : null;
  }

  public async findMany(
    filter: RepositoryFilter,
    options?: IQueryOptions,
  ): Promise<ViewModel[]> {
    this.assertScoped(filter, 'findMany');

    let query = this.ordered(this.select(filter), options?.orderBy);

    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    const rows = await this.run('findMany', () => query.execute());

    return rows.map((row) => this.toViewModel(row));
  }

  public async search(
    params: ISearchParams<RepositoryFilter>,
  ): Promise<ISearchResult<ViewModel>> {
    const {
      page = 1,
      pageSize = this.defaultPageLimit,
      orderBy = this.defaultOrderBy,
      searchTerm,
      filters = {},
    } = params;

    this.assertScoped(filters, 'search');

    const matches = (eb: AnyExpressions) =>
      eb.and([
        this.where(eb, filters),
        ...(searchTerm && this.searchableColumns.length
          ? [
              eb.or(
                this.searchableColumns.map((column) =>
                  eb(eb.ref(column), 'ilike', `%${escapeLike(searchTerm)}%`),
                ),
              ),
            ]
          : []),
      ]);

    const [rows, totalCount] = await this.run('search', () =>
      Promise.all([
        this.ordered(this.selectRows().where(matches), orderBy)
          .limit(pageSize)
          .offset((page - 1) * pageSize)
          .execute(),
        this.countWhere(matches),
      ]),
    );

    return {
      items: rows.map((row) => this.toViewModel(row)),
      totalCount,
      page,
      pageSize,
    };
  }

  public async count(filter: RepositoryFilter): Promise<number> {
    this.assertScoped(filter, 'count');

    return this.run('count', () =>
      this.countWhere((eb) => this.where(eb, filter)),
    );
  }

  public async create(data: SqlInsert<Table>): Promise<ViewModel> {
    this.assertRowsScoped([data], 'create');

    const [row] = await this.run('create', () =>
      this.written(this.anyDb.insertInto(this.table).values(data as AnyRow)),
    );

    return this.toViewModel(row);
  }

  public async createMany(data: SqlInsert<Table>[]): Promise<ViewModel[]> {
    if (data.length === 0) {
      return [];
    }

    this.assertRowsScoped(data, 'createMany');

    const rows = await this.run('createMany', () =>
      this.written(this.anyDb.insertInto(this.table).values(data as AnyRow[])),
    );

    return rows.map((row) => this.toViewModel(row));
  }

  // Changes exactly one row. When the filter matches none or several, nothing
  // changes and it throws, as PostgREST does for a single object.
  public async update(
    filter: RepositoryFilter,
    data: SqlUpdate<Table>,
  ): Promise<ViewModel> {
    this.assertScoped(filter, 'update');

    const rows = await this.run('update', () =>
      this.written(
        this.anyDb
          .updateTable(this.table)
          .set(data as AnyRow)
          .where((eb) =>
            eb.and([
              this.where(eb, filter),
              eb(
                eb
                  .selectFrom(`${this.table} as matching`)
                  .select((inner) => inner.fn.countAll().as('count'))
                  .where((inner) => this.where(inner, filter)),
                '=',
                1,
              ),
            ]),
          ),
      ),
    );

    if (rows.length !== 1) {
      const matching = await this.count(filter);

      throw new Error(
        `[${this.tableName}] update error: the filter matches ${matching ? `${matching} rows` : 'no row'}`,
      );
    }

    return this.toViewModel(rows[0]);
  }

  public async updateMany(
    filter: RepositoryFilter,
    data: SqlUpdate<Table>,
  ): Promise<ViewModel[]> {
    this.assertScoped(filter, 'updateMany');

    const rows = await this.run('updateMany', () =>
      this.written(
        this.anyDb
          .updateTable(this.table)
          .set(data as AnyRow)
          .where((eb) => this.where(eb, filter)),
      ),
    );

    return rows.map((row) => this.toViewModel(row));
  }

  public async upsert(
    data: SqlInsert<Table> | SqlInsert<Table>[],
    onConflict: string | string[] = 'id',
  ): Promise<ViewModel | ViewModel[]> {
    const isArray = Array.isArray(data);
    const rows = isArray ? data : [data];

    this.assertRowsScoped(rows, 'upsert');

    if (rows.length === 0) {
      return [];
    }

    const conflictColumns = Array.isArray(onConflict)
      ? onConflict
      : onConflict.split(',').map((column) => column.trim());
    // The columns given a value: one left undefined keeps what the row has,
    // as with PostgREST, which never sees undefined (JSON drops it).
    const columns = [
      ...new Set(
        rows.flatMap((row) =>
          Object.entries(row)
            .filter(([, value]) => value !== undefined)
            .map(([column]) => column),
        ),
      ),
    ];

    const upserted = await this.run('upsert', () =>
      this.written(
        this.anyDb
          .insertInto(this.table)
          .values(rows as AnyRow[])
          .onConflict((conflict) =>
            conflict
              .columns(conflictColumns)
              .doUpdateSet((eb) =>
                Object.fromEntries(
                  columns.map((column) => [
                    column,
                    eb.ref(`excluded.${column}`),
                  ]),
                ),
              ),
          ),
      ),
    );

    const viewModels = upserted.map((row) => this.toViewModel(row));

    return isArray ? viewModels : viewModels[0];
  }

  public async deleteMany(filter: RepositoryFilter): Promise<number> {
    this.assertScoped(filter, 'deleteMany');

    const result = await this.run('deleteMany', () =>
      this.anyDb
        .deleteFrom(this.table)
        .where((eb) => this.where(eb, filter))
        .executeTakeFirstOrThrow(),
    );

    return Number(result.numDeletedRows);
  }

  // The queries a subclass writes itself start from these, so that they are
  // scoped to one workspace like the generic ones, and typed by the table.
  // A select names the table with the column, so that it may join another
  // workspace table.
  protected selectInWorkspace(
    slackTeamId: string,
  ): SelectQueryBuilder<SqlDatabase, Table, object> {
    return this.anyDb
      .selectFrom(this.table)
      .where(
        `${this.table}.${this.workspaceRef()}`,
        '=',
        this.requireId(slackTeamId),
      ) as never;
  }

  protected updateInWorkspace(
    slackTeamId: string,
  ): UpdateQueryBuilder<SqlDatabase, Table, Table, UpdateResult> {
    return this.anyDb
      .updateTable(this.table)
      .where(this.workspaceRef(), '=', this.requireId(slackTeamId)) as never;
  }

  protected deleteInWorkspace(
    slackTeamId: string,
  ): DeleteQueryBuilder<SqlDatabase, Table, DeleteResult> {
    return this.anyDb
      .deleteFrom(this.table)
      .where(this.workspaceRef(), '=', this.requireId(slackTeamId)) as never;
  }

  protected toViewModel(row: AnyRow): ViewModel {
    return this.mapToViewModel(row as SqlRow<Table>);
  }

  // The table name for the untyped queries.
  private get table(): string {
    return this.tableName;
  }

  private get anyDb(): Kysely<AnyDatabase> {
    return this.database.db as unknown as Kysely<AnyDatabase>;
  }

  private selectRows(): AnySelect {
    const query = this.anyDb.selectFrom(this.table).selectAll(this.table);

    return this.relations
      ? query.select((eb) => this.relationColumns(eb, this.table))
      : query;
  }

  private select(filter: RepositoryFilter): AnySelect {
    return this.selectRows().where((eb) => this.where(eb, filter));
  }

  private async countWhere(
    condition: (eb: AnyExpressions) => Expression<SqlBool>,
  ): Promise<number> {
    const { count } = await this.anyDb
      .selectFrom(this.table)
      .select((eb) => eb.fn.countAll().as('count'))
      .where(condition)
      .executeTakeFirstOrThrow();

    return Number(count);
  }

  // The written rows with their relations: in one statement, which reads the
  // rows the write returns.
  private written(
    query:
      | InsertQueryBuilder<AnyDatabase, string, object>
      | UpdateQueryBuilder<AnyDatabase, string, string, object>,
  ): Promise<AnyRow[]> {
    const returning = query.returningAll();

    if (!this.relations) {
      return returning.execute();
    }

    return this.anyDb
      .with('written', () => returning)
      .selectFrom('written')
      .selectAll('written')
      .select((eb) => this.relationColumns(eb, 'written'))
      .execute();
  }

  private relationColumns(eb: AnyExpressions, source: string) {
    return Object.entries(this.relations ?? {}).map(([alias, relation]) =>
      jsonObjectFrom(
        eb
          .selectFrom(`${relation.table} as ${alias}`)
          .select(relation.columns)
          .whereRef(`${alias}.id`, '=', `${source}.${relation.foreignKey}`),
      ).as(alias),
    );
  }

  private ordered(query: AnySelect, orderBy = this.defaultOrderBy) {
    const columnOf = (order: string) => order.split(':')[0];
    const ordered = new Set(orderBy.map(columnOf));

    return [
      ...orderBy,
      ...this.uniqueOrder.filter((order) => !ordered.has(columnOf(order))),
    ].reduce((sorted, order) => {
      const [column, direction = 'asc'] = order.split(':');

      return sorted.orderBy(
        sql.ref(column),
        direction === 'desc' ? 'desc' : 'asc',
      );
    }, query);
  }

  // Column names in a filter are left unqualified: inside a subquery on the
  // same table (update's "exactly one row" check) they name its rows.
  private where(
    eb: AnyExpressions,
    filter: RepositoryFilter,
  ): Expression<SqlBool> {
    const conditions: Expression<SqlBool>[] = [];

    for (const [column, value] of Object.entries(filter)) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        const isPlainValuesList = value.every(
          (item) => typeof item === 'string' || typeof item === 'number',
        );

        if (isPlainValuesList) {
          conditions.push(this.inList(eb, column, value));
          continue;
        }

        for (const params of value as IFilterParams[]) {
          conditions.push(this.condition(eb, column, params));
        }
      } else if (isFilterParams(value)) {
        conditions.push(this.condition(eb, column, value));
      } else {
        conditions.push(this.condition(eb, column, { operator: 'eq', value }));
      }
    }

    return conditions.length ? eb.and(conditions) : sql<SqlBool>`true`;
  }

  private condition(
    eb: AnyExpressions,
    column: string,
    { operator, value }: IFilterParams,
  ): Expression<SqlBool> {
    if (operator === 'in') {
      return this.inList(eb, column, value as unknown[]);
    }

    // `= null` is never true; PostgREST's eq.null meant "is null" here.
    if (operator === 'eq' && value === null) {
      return eb(eb.ref(column), 'is', null);
    }

    // An array is one value for the array operators; anywhere else Kysely
    // would make it a list, `($1, $2)`.
    const operand = ARRAY_OPERATORS.has(operator) ? eb.val(value) : value;

    return eb(eb.ref(column), OPERATORS[operator], operand);
  }

  // An empty list matches no row, as `in ()` would: skipping it would match
  // every row (a manager of no teams would see everyone).
  private inList(
    eb: AnyExpressions,
    column: string,
    values: unknown[],
  ): Expression<SqlBool> {
    return values.length
      ? eb(eb.ref(column), 'in', values)
      : sql<SqlBool>`false`;
  }

  private workspaceRef(): string {
    if (!this.workspaceColumn) {
      throw new Error(`[${this.tableName}] is not a workspace's table`);
    }

    return this.workspaceColumn;
  }

  private requireId(slackTeamId: string) {
    if (!slackTeamId) {
      throw new Error(
        `[${this.tableName}] query without ${this.workspaceRef()}`,
      );
    }

    return slackTeamId;
  }

  private async run<T>(operation: string, query: () => Promise<T>) {
    try {
      return await query();
    } catch (error) {
      // The cause keeps Postgres's error code (e.g. 23505 for a duplicate).
      throw Object.assign(
        new Error(
          `[${this.tableName}] ${operation} error: ${(error as Error).message}`,
        ),
        { cause: error },
      );
    }
  }

  private assertScoped(filter: RepositoryFilter, operation: string) {
    assertScoped(this.tableName, this.workspaceColumn, filter, operation);
  }

  private assertRowsScoped(rows: object[], operation: string) {
    assertRowsScoped(this.tableName, this.workspaceColumn, rows, operation);
  }
}
