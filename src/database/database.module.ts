import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { MigrationsCheckService } from 'src/database/migrations-check.service';
import { DatabaseService } from 'src/database/database.service';

// Two ways to the same Postgres while the repositories move off PostgREST:
// SupabaseService (PostgREST over HTTPS) and DatabaseService (DATABASE_URL).
@Global()
@Module({
  providers: [SupabaseService, DatabaseService, MigrationsCheckService],
  exports: [SupabaseService, DatabaseService],
})
export class DatabaseModule {}
