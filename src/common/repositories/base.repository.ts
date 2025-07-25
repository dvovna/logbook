import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/types/database.types';
import { SupabaseService } from 'src/supabase/supabase.service';

export type Tables = Database['public']['Tables'];
export type TableName = keyof Tables;

export abstract class BaseRepository<
  Entity extends Tables[TableName],
  ViewModel,
> {
  protected readonly client: SupabaseClient<Database>;

  protected tableName: TableName;

  private supabaseService: SupabaseService;

  protected constructor() {
    this.client = this.supabaseService.getClient();
  }

  public async findOne(filters: Partial<Entity['Row']>) {
    const query = this.client.from(this.tableName).select('*');

    this.buildFindQuery(query, filters);

    const result = await query.single();

    const item = result.data as unknown as Entity['Row'] | null;

    return item ? this.mapToViewModel(item) : null;
  }

  public async findAll(filter: Partial<Entity['Row']>): Promise<ViewModel[]> {
    const query = this.client.from(this.tableName).select('*');

    this.buildFindQuery(query, filter);

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

  public async update(
    filter: Partial<Entity['Row']>,
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

  public async delete(filter: Partial<Entity['Row']>): Promise<void> {
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
    filters: Partial<Entity['Row']>,
  ) {
    for (const [key, value] of Object.entries(filters)) {
      query.eq(key as keyof Entity['Row'] as string, value as never);
    }

    return query;
  }
}
