import { Global, Module } from '@nestjs/common';
import { MigrationsCheckService } from 'src/database/migrations-check.service';
import { DatabaseService } from 'src/database/database.service';
import { TransactionService } from 'src/database/transaction.service';

// The app's connections to Postgres (DATABASE_URL): DatabaseService runs the
// repositories' queries, and services group them with TransactionService.
@Global()
@Module({
  providers: [DatabaseService, TransactionService, MigrationsCheckService],
  exports: [DatabaseService, TransactionService],
})
export class DatabaseModule {}
