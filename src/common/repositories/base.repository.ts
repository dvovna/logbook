import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/common/types/database.types';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Injectable } from '@nestjs/common';
import {
  ISearchResult,
  ISearchParams,
} from 'src/common/types/pagination.types';

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
  | 'lt'
  | 'lte'
  | 'in'
  | 'like'
  | 'ilike';

type SupabaseFilter = Record<
  string,
  | SupabaseSimpleValue
  | undefined
  | {
      operator: SupabaseFilterOperator;
      value: SupabaseSimpleValue;
    }
>;

interface IQueryOptions {
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

  protected readonly defaultLimit = 100;

  protected readonly defaultPageLimit = 10;

  protected searchableColumns: string[] = [];

  public constructor(private supabaseService: SupabaseService) {
    this.client = this.supabaseService.getClient();
  }

  public async findOne(filter: SupabaseFilter) {
    const query = this.client.from(this.tableName).select('*');

    this.buildMatchQuery(query, filter);

    const result = await query.single();

    const item = result.data as unknown as Entity['Row'] | null;

    return item ? this.mapToViewModel(item) : null;
  }

  public async findMany(
    filter: SupabaseFilter,
    options?: IQueryOptions,
  ): Promise<ViewModel[]> {
    const query = this.client.from(this.tableName).select('*');

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
      sortBy = 'created_at',
      sortOrder = 'desc',
      searchTerm,
      filters = {},
    } = params;

    let query = this.client
      .from(this.tableName)
      .select('*', { count: 'exact' });

    this.buildFindQuery(query, filters, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: [`${sortBy}:${sortOrder}`],
    });

    if (searchTerm && this.searchableColumns.length > 0) {
      const ilikeFilter = `%${searchTerm}%`;

      query = query.ilike(this.searchableColumns[0], ilikeFilter);

      if (this.searchableColumns.length > 1) {
        const orConditions = this.searchableColumns
          .slice(1)
          .map((col) => `${col}.ilike.${ilikeFilter}`)
          .join(',');

        query = query.or(orConditions);
      }
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
      .select()
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

    const { data: updated, error } = await query.select().single();

    if (error) {
      throw new Error(`[${this.tableName}] update error: ${error.message}`);
    }

    return this.mapToViewModel(updated as unknown as Entity['Row']);
  }

  public async delete(filter: SupabaseFilter): Promise<void> {
    const query = this.client.from(this.tableName).delete();

    this.buildMatchQuery(query, filter);

    const { error } = await query;

    if (error) {
      throw new Error(`[${this.tableName}] delete error: ${error.message}`);
    }
  }

  protected mapToViewModel = (_row: Entity['Row']): ViewModel => {
    // This method should be implemented in subclasses to map the database row to the view model.
    throw new Error('Method not implemented.');
  };

  private buildMatchQuery(
    query: ReturnType<SupabaseClient<Database>['from']>,
    filters: SupabaseFilter,
  ) {
    for (const [column, filter] of Object.entries(filters)) {
      if (filter === undefined) {
        continue;
      }

      if (
        typeof filter === 'object' &&
        filter !== null &&
        'operator' in filter &&
        'value' in filter
      ) {
        const { operator, value } = filter;

        switch (operator) {
          case 'eq':
            query = query.eq(column, value);
            break;
          case 'neq':
            query = query.neq(column, value);
            break;
          case 'gt':
            query = query.gt(column, value);
            break;
          case 'gte':
            query = query.gte(column, value);
            break;
          case 'lt':
            query = query.lt(column, value);
            break;
          case 'lte':
            query = query.lte(column, value);
            break;
          case 'in':
            query = query.in(column, value as unknown[]);
            break;
          case 'like':
            query = query.like(column, value as string);
            break;
          case 'ilike':
            query = query.ilike(column, value as string);
            break;
          default:
            throw new Error(`Unsupported operator: ${operator}`);
        }
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

    if (options?.orderBy) {
      options.orderBy.forEach((order) => {
        const [column, direction = 'asc'] = order.split(':');
        query = query.order(column, { ascending: direction === 'asc' });
      });
    } else {
      query = query.order('created_at', { ascending: false });
    }
  }
}
