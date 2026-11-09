import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@common/types/database.types';
import { SupabaseService } from 'src/database/supabase.service';
import { Injectable } from '@nestjs/common';
import { ISearchResult, ISearchParams } from '@common/types/pagination.types';
import {
  assertRowsScoped,
  assertScoped,
  IFilterParams,
  IQueryOptions,
  IRepository,
  isFilterParams,
  RepositoryFilter,
} from '@common/repositories/repository.types';

export type Tables = Database['public']['Tables'];
export type TableName = keyof Tables;
// The filters are shared with SqlRepository; the old names stay for the
// services that import them from here.
export type SupabaseFilter = RepositoryFilter;
export type { IQueryOptions };

// PostgREST reads `,`, `.`, `:` and parentheses in a filter value as filter
// syntax unless the value is in double quotes, where `\` escapes `"` and `\`.
// Text the user typed goes into .or() only quoted, so it cannot add
// conditions of its own.
export const quoteFilterValue = (value: string) =>
  `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;

// PostgREST returns at most `max_rows` rows a request (1000 in
// supabase/config.toml and on hosted projects) and says nothing when it cuts a
// result short, so findMany reads in pages no larger than that.
export const PAGE_SIZE = 1000;

// `this.tableName` is a union of all tables, so supabase-js can't check an
// insert or update against one table's columns and the data is cast to
// `never` there. Each subclass's Entity type is what keeps the data right.
@Injectable()
export abstract class BaseRepository<
  Entity extends Tables[TableName],
  ViewModel,
> implements IRepository<Entity['Insert'], Entity['Update'], ViewModel> {
  protected readonly client: SupabaseClient<Database>;

  protected tableName: TableName;

  protected relations: Record<string, unknown> | null = null;

  protected readonly defaultPageLimit = 10;

  protected searchableColumns: string[] = [];

  protected defaultOrderBy: string[] = ['created_at:desc'];

  // Columns that tell any two rows apart. They end every order, so that pages
  // of one result neither skip nor repeat rows that sort the same.
  protected readonly uniqueOrder: string[] = ['id:asc'];

  // The column that ties a row to its workspace. Every query and insert on a
  // workspace's table must name the workspace: a filter value that is
  // undefined is left out of the query, so a missing ID would otherwise read
  // or change other workspaces' rows. null only for slack_teams itself.
  protected readonly workspaceColumn: string | null = 'slack_team_id';

  public constructor(private supabaseService: SupabaseService) {
    this.client = this.supabaseService.getClient();
  }

  public async findOne(filter: SupabaseFilter) {
    this.assertScoped(filter, 'findOne');

    const query = this.client.from(this.tableName).select(this.buildSelect());

    this.buildMatchQuery(query, filter);

    // No row is null; a failed query or several rows is an error, not "not
    // found". Two rows are enough to tell "several" apart.
    const { data, error } = await query.limit(2).maybeSingle();

    if (error) {
      throw new Error(`[${this.tableName}] findOne error: ${error.message}`);
    }

    return data ? this.mapToViewModel(data as unknown as Entity['Row']) : null;
  }

  public async findMany(
    filter: SupabaseFilter,
    options?: IQueryOptions,
  ): Promise<ViewModel[]> {
    this.assertScoped(filter, 'findMany');

    const start = options?.offset ?? 0;
    const wanted = options?.limit ?? Infinity;
    const rows: Entity['Row'][] = [];

    while (rows.length < wanted) {
      const limit = Math.min(PAGE_SIZE, wanted - rows.length);
      const query = this.client.from(this.tableName).select(this.buildSelect());

      this.buildFindQuery(query, filter, {
        ...options,
        offset: start + rows.length,
        limit,
      });

      const { data, error } = await query;

      if (error) {
        throw new Error(`[${this.tableName}] findMany error: ${error.message}`);
      }

      const page = (data ?? []) as unknown as Entity['Row'][];

      rows.push(...page);

      if (page.length < limit) {
        break;
      }
    }

    return rows.map(this.mapToViewModel);
  }

  public async search(
    params: ISearchParams<SupabaseFilter>,
  ): Promise<ISearchResult<ViewModel>> {
    const {
      page = 1,
      pageSize = this.defaultPageLimit,
      orderBy = this.defaultOrderBy,
      searchTerm,
      filters = {},
    } = params;

    this.assertScoped(filters, 'search');

    let query = this.client
      .from(this.tableName)
      .select(this.buildSelect(), { count: 'exact' });

    this.buildFindQuery(query, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy,
    });

    if (searchTerm && this.searchableColumns.length > 0) {
      const ilikeFilter = quoteFilterValue(`%${searchTerm}%`);

      const orConditions = this.searchableColumns
        .map((col) => `${col}.ilike.${ilikeFilter}`)
        .join(',');

      query = query.or(orConditions);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`[${this.tableName}] search error: ${error.message}`);
    }

    const items = (data as unknown as Entity['Row'][]) ?? [];

    return {
      items: items.map(this.mapToViewModel),
      totalCount: count ?? 0,
      page,
      pageSize,
    };
  }

  public async count(filter: SupabaseFilter): Promise<number> {
    this.assertScoped(filter, 'count');

    const query = this.client
      .from(this.tableName)
      .select('*', { count: 'exact', head: true });

    this.buildMatchQuery(query, filter);

    const { count, error } = await query;

    if (error) {
      throw new Error(`[${this.tableName}] count error: ${error.message}`);
    }

    return count ?? 0;
  }

  public async create(data: Entity['Insert']): Promise<ViewModel> {
    this.assertRowsScoped([data], 'create');

    const { data: inserted, error } = await this.client
      .from(this.tableName)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      .insert(data)
      .select(this.buildSelect())
      .single();

    if (error) {
      throw new Error(`[${this.tableName}] create error: ${error.message}`);
    }

    return this.mapToViewModel(inserted as unknown as Entity['Row']);
  }

  public async createMany(data: Entity['Insert'][]): Promise<ViewModel[]> {
    if (data.length === 0) {
      return [];
    }

    this.assertRowsScoped(data, 'createMany');

    const { data: inserted, error } = await this.client
      .from(this.tableName)
      .insert(data as never)
      .select();

    if (error) {
      throw new Error(`Failed to bulk insert: ${error.message}`);
    }

    return inserted.map((record) => this.mapToViewModel(record));
  }

  public async update(
    filter: SupabaseFilter,
    data: Entity['Update'],
  ): Promise<ViewModel> {
    this.assertScoped(filter, 'update');

    const query = this.client.from(this.tableName).update(data as never);

    this.buildMatchQuery(query, filter);

    const { data: updated, error } = await query
      .select(this.buildSelect())
      .single();

    if (error) {
      throw new Error(`[${this.tableName}] update error: ${error.message}`);
    }

    return this.mapToViewModel(updated as unknown as Entity['Row']);
  }

  public async updateMany(
    filter: SupabaseFilter,
    data: Entity['Update'],
  ): Promise<ViewModel[]> {
    this.assertScoped(filter, 'updateMany');

    const query = this.client.from(this.tableName).update(data as never);

    this.buildMatchQuery(query, filter);

    const { data: updated, error } = await query.select(this.buildSelect());

    if (error) {
      throw new Error(`[${this.tableName}] updateMany error: ${error.message}`);
    }

    return (updated as unknown as Entity['Row'][]).map((row) =>
      this.mapToViewModel(row),
    );
  }

  public async upsert(
    data: Entity['Insert'] | Entity['Insert'][],
    onConflict: string | string[] = 'id',
  ): Promise<ViewModel | ViewModel[]> {
    const isArray = Array.isArray(data);

    this.assertRowsScoped(isArray ? data : [data], 'upsert');

    const { data: upserted, error } = await this.client
      .from(this.tableName)
      // @ts-expect-error: supabase types can be too strict here
      .upsert(data, { onConflict })
      .select(this.buildSelect());

    if (error) {
      throw new Error(`[${this.tableName}] upsert error: ${error.message}`);
    }

    if (!upserted) {
      return isArray ? [] : (null as unknown as ViewModel);
    }

    return isArray
      ? (upserted as unknown as Entity['Row'][]).map(this.mapToViewModel)
      : this.mapToViewModel(upserted[0] as unknown as Entity['Row']);
  }

  public async deleteMany(filter: SupabaseFilter): Promise<number> {
    this.assertScoped(filter, 'deleteMany');

    const query = this.client.from(this.tableName).delete();

    this.buildMatchQuery(query, filter);

    const { data, error } = await query.select('id');

    if (error) {
      throw new Error(`[${this.tableName}] deleteMany error: ${error.message}`);
    }

    return (data as unknown as { id: string }[]).length;
  }

  private assertScoped(filter: SupabaseFilter, operation: string) {
    assertScoped(this.tableName, this.workspaceColumn, filter, operation);
  }

  private assertRowsScoped(rows: object[], operation: string) {
    assertRowsScoped(this.tableName, this.workspaceColumn, rows, operation);
  }

  private buildSelect() {
    if (!this.relations) {
      return '*';
    }

    const relationStrings = Object.entries(this.relations).map(
      ([alias, relation]) => `${alias}:${relation}`,
    );

    return ['*', ...relationStrings].join(', ');
  }

  protected mapToViewModel = (_row: Entity['Row']): ViewModel => {
    // This method should be implemented in subclasses to map the database row to the view model.
    throw new Error('Method not implemented.');
  };

  private buildMatchQuery(
    query: ReturnType<SupabaseClient<Database>['from']>,
    filters: SupabaseFilter,
  ) {
    const applyFilter = (
      query: ReturnType<SupabaseClient<Database>['from']>,
      column: string,
      filter: IFilterParams,
    ) => {
      const { operator, value } = filter;

      switch (operator) {
        case 'eq':
          return query.eq(column, value);
        case 'neq':
          return query.neq(column, value);
        case 'gt':
          return query.gt(column, value);
        case 'gte':
          return query.gte(column, value);
        case 'lt':
          return query.lt(column, value);
        case 'lte':
          return query.lte(column, value);
        case 'in':
          return query.in(column, value as unknown[]);
        case 'like':
          return query.like(column, value as string);
        case 'ilike':
          return query.ilike(column, value as string);
        case 'is':
          return query.is(column, value);
        case 'not.is':
          return query.not(column, 'is', value);
        case 'cs':
          return query.contains(column, value as unknown[]);
        case 'cd':
          return query.containedBy(column, value as unknown[]);
        case 'ov':
          return query.overlaps(column, value as unknown[]);
        default:
          throw new Error(`Unsupported operator: ${operator}`);
      }
    };

    for (const [column, filter] of Object.entries(filters)) {
      if (filter === undefined) {
        continue;
      }

      if (Array.isArray(filter)) {
        // An empty list matches no row, as `in ()` does: skipping it would
        // match every row (a manager of no teams would see everyone).
        if (filter.length === 0) {
          query = query.in(column, []);
          continue;
        }

        const isPlainValuesList = filter.every(
          (value) => typeof value === 'string' || typeof value === 'number',
        );

        if (isPlainValuesList) {
          query = query.in(column, filter);
          continue;
        }

        for (const params of filter) {
          query = applyFilter(query, column, params);
        }
      } else if (isFilterParams(filter)) {
        query = applyFilter(query, column, filter);
      } else {
        query = query.eq(column, filter);
      }
    }

    return query;
  }

  private buildFindQuery(
    query: ReturnType<SupabaseClient<Database>['from']>,
    filters: SupabaseFilter,
    options?: IQueryOptions,
  ) {
    this.buildMatchQuery(query, filters);

    if (options?.limit !== undefined && options?.offset !== undefined) {
      query.range(options.offset, options.offset + options.limit - 1);
    } else if (options?.limit !== undefined) {
      query.limit(options.limit);
    }

    const orderByOptions = options?.orderBy ?? this.defaultOrderBy;
    const columnOf = (order: string) => order.split(':')[0];
    const ordered = new Set(orderByOptions.map(columnOf));

    [
      ...orderByOptions,
      ...this.uniqueOrder.filter((order) => !ordered.has(columnOf(order))),
    ].forEach((order) => {
      const [column, direction = 'asc'] = order.split(':');
      query = query.order(column, { ascending: direction === 'asc' });
    });
  }
}
