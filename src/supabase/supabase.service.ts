import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/common/types/database.types';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient<Database>;

  public constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_ANON_KEY');

    if (!url || !key) {
      throw new Error('Supabase configuration missing');
    }

    this.client = createClient<Database>(url, key);
  }

  public getClient(): SupabaseClient<Database> {
    return this.client;
  }
}
