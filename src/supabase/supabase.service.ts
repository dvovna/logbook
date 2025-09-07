import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/common/types/database.types';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient<Database>;

  public constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>(EnvironmentVariable.SupabaseUrl);
    const key = this.config.get<string>(EnvironmentVariable.SupabaseAnonKey);

    if (!url || !key) {
      throw new Error('Supabase configuration missing');
    }

    this.client = createClient<Database>(url, key);
  }

  public getClient(): SupabaseClient<Database> {
    return this.client;
  }
}
