import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/common/types/database.types';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Injectable } from '@nestjs/common';

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

  public constructor(private supabaseService: SupabaseService) {
    this.client = this.supabaseService.getClient();
  }

  public async findOne(filter: SupabaseFilter, options?: IQueryOptions) {
    const query = this.client.from(this.tableName).select('*');

    this.buildFindQuery(query, filter, options);

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

    this.buildFindQuery(query, filter);

    const { data: updated, error } = await query.select().single();

    if (error) {
      throw new Error(`[${this.tableName}] update error: ${error.message}`);
    }

    return this.mapToViewModel(updated as unknown as Entity['Row']);
  }

  public async delete(filter: SupabaseFilter): Promise<void> {
    const query = this.client.from(this.tableName).delete();

    this.buildFindQuery(query, filter);

    const { error } = await query;

    if (error) {
      throw new Error(`[${this.tableName}] delete error: ${error.message}`);
    }
  }

  protected mapToViewModel = (_row: Entity['Row']): ViewModel => {
    // This method should be implemented in subclasses to map the database row to the view model.
    throw new Error('Method not implemented.');
  };

  private buildFindQuery(
    query: ReturnType<SupabaseClient<Database>['from']>,
    filters: SupabaseFilter,
    options?: IQueryOptions,
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

    query.limit(options?.limit ?? this.defaultLimit);

    if (options?.offset) {
      query.offset(options.offset);
    }

    if (options?.orderBy) {
      options.orderBy.forEach((order) => {
        const [column, direction = 'asc'] = order.split(':');
        query = query.order(column, { ascending: direction === 'asc' });
      });
    }

    return query;
  }
}
