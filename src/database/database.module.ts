import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { MigrationsCheckService } from 'src/database/migrations-check.service';
import { DatabaseService } from 'src/database/database.service';
import { TransactionService } from 'src/database/transaction.service';

// Two ways to the same Postgres while the repositories move off PostgREST:
// SupabaseService (PostgREST over HTTPS) and DatabaseService (DATABASE_URL),
// whose transactions the services start through TransactionService.
@Global()
@Module({
  providers: [
    SupabaseService,
    DatabaseService,
    TransactionService,
    MigrationsCheckService,
  ],
  exports: [SupabaseService, DatabaseService, TransactionService],
})
export class DatabaseModule {}
