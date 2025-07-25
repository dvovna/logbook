import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'src/types/database.types';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient<Database> = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );

  public getClient() {
    return this.client;
  }
}
