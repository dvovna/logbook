import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@common/types/database.types';
import { SupabaseService } from 'src/database/supabase.service';
import { Injectable } from '@nestjs/common';
import { ISearchResult, ISearchParams } from '@common/types/pagination.types';

export type Tables = Database['public']['Tables'];
export type TableName = keyof Tables;
type SupabaseSimpleValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[];

type SupabaseFilterOperator =
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

interface IFilterParams {
  operator: SupabaseFilterOperator;
  value: SupabaseSimpleValue;
}

export type SupabaseFilter = Record<
  string,
  SupabaseSimpleValue | undefined | IFilterParams | IFilterParams[]
>;

export interface IQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string[];
}

@Injectable()
export abstract class BaseRepository<
  Entity extends Tables[TableName],
  ViewModel,
> {
  protected readonly client: SupabaseClient<Database>;

  protected tableName: TableName;

  protected relations: Record<string, unknown> | null = null;

  protected readonly defaultLimit = 10000;

  protected readonly defaultPageLimit = 5;

  protected searchableColumns: string[] = [];

  protected defaultOrderBy: string[] = ['created_at:desc'];

  public constructor(private supabaseService: SupabaseService) {
    this.client = this.supabaseService.getClient();
  }

  public async findOne(filter: SupabaseFilter) {
    const query = this.client.from(this.tableName).select(this.buildSelect());

    this.buildMatchQuery(query, filter);

    const result = await query.single();

    const item = result.data as unknown as Entity['Row'] | null;

    return item ? this.mapToViewModel(item) : null;
  }

  public async findMany(
    filter: SupabaseFilter,
    options?: IQueryOptions,
  ): Promise<ViewModel[]> {
    const query = this.client.from(this.tableName).select(this.buildSelect());

    this.buildFindQuery(query, filter, options);

    const { data, error } = await query;

    if (error) {
      throw new Error(`[${this.tableName}] findAll error: ${error.message}`);
    }

    const items = data as unknown as Entity['Row'][] | null;

    return items ? items.map(this.mapToViewModel) : [];
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

    let query = this.client
      .from(this.tableName)
      .select(this.buildSelect(), { count: 'exact' });

    this.buildFindQuery(query, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy,
    });

    if (searchTerm && this.searchableColumns.length > 0) {
      const ilikeFilter = `%${searchTerm}%`;

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

    const { data: inserted, error } = await this.client
      .from(this.tableName)
      .insert(data)
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
    const query = this.client.from(this.tableName).update(data);

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
    const query = this.client.from(this.tableName).update(data);

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
    const query = this.client.from(this.tableName).delete();

    this.buildMatchQuery(query, filter);

    const { data, error } = await query.select('id');

    if (error) {
      throw new Error(`[${this.tableName}] deleteMany error: ${error.message}`);
    }

    return (data as unknown as { id: string }[]).length;
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
        if (filter.length === 0) {
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
      } else if (
        typeof filter === 'object' &&
        filter !== null &&
        'operator' in filter &&
        'value' in filter
      ) {
        query = applyFilter(query, column, filter);
      } else {
        query = query.eq(column, filter as SupabaseSimpleValue);
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
    } else {
      query.limit(options?.limit ?? this.defaultLimit);
    }

    const orderByOptions = options?.orderBy ?? this.defaultOrderBy;

    orderByOptions.forEach((order) => {
      const [column, direction = 'asc'] = order.split(':');
      query = query.order(column, { ascending: direction === 'asc' });
    });
  }
}
