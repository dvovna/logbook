import { Injectable, Logger } from '@nestjs/common';
import { CompiledQuery, sql } from 'kysely';
import { runInBackground } from '@common/utils/run-in-background';
import { DatabaseService } from 'src/database/database.service';
import {
  currentTransaction,
  ITransactionScope,
  transactionScopes,
} from 'src/database/transaction-scope';

// What services may do with the database: group repository calls into one
// transaction, and run work after it. The queries themselves stay in the
// repositories (DatabaseService), which keep them scoped to a workspace.
@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  public constructor(private readonly database: DatabaseService) {}

  public get inTransaction(): boolean {
    return !!currentTransaction();
  }

  // Runs `work` in one transaction: it commits when `work` resolves and rolls
  // back when it throws. Every SqlRepository call inside `work` takes part;
  // PostgREST calls never do. A transaction() inside another one joins it.
  // No Slack calls inside: they would hold the connection and the locks.
  public async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return work();
    }

    const scope: ITransactionScope = {
      trx: this.database.db,
      afterCommit: [],
      done: false,
    };
    let result: T;

    try {
      result = await this.database.db.transaction().execute((trx) => {
        scope.trx = trx;

        return transactionScopes.run(scope, work);
      });
    } finally {
      scope.done = true;
    }

    for (const callback of scope.afterCommit) {
      runInBackground(this.logger, 'run work after a commit', callback);
    }

    return result;
  }

  // Runs `callback` once the current transaction has committed (never when it
  // rolls back), as background work; outside a transaction, at once. For
  // what must not happen before the data is visible to others: first runs of
  // jobs, events, Slack messages.
  public afterCommit(callback: () => Promise<unknown>) {
    const scope = currentTransaction();

    if (scope) {
      scope.afterCommit.push(callback);

      return;
    }

    runInBackground(this.logger, 'run work after a commit', callback);
  }

  // Serializes the transactions that take the same key until they end, e.g.
  // the checks of a per-workspace limit and the insert after them.
  public async lock(key: string) {
    if (!this.inTransaction) {
      throw new Error(`lock(${key}) outside a transaction holds nothing`);
    }

    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
      this.database.db,
    );
  }

  // Runs another library's SQL (pg-boss's `db` option) on the current
  // transaction, or the pool.
  public sqlExecutor() {
    const db = this.database.db;

    return {
      executeSql: (text: string, values: unknown[]) =>
        db.executeQuery(CompiledQuery.raw(text, values)),
    };
  }
}
