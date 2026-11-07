import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { MigrationsCheckService } from 'src/database/migrations-check.service';

@Global()
@Module({
  providers: [SupabaseService, MigrationsCheckService],
  exports: [SupabaseService],
})
export class DatabaseModule {}
