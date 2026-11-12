import { Injectable, Logger } from '@nestjs/common';
import { CompiledQuery, sql } from 'kysely';
import { runInBackground } from '@common/utils/run-in-background';
import { compareLocks, IAdvisoryLock } from 'src/database/advisory-locks';
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
  // back when it throws. Every repository call inside `work` takes part, and
  // a transaction() inside another one joins it.
  // No Slack calls inside: they would hold the connection and the locks.
  public async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return work();
    }

    const scope: ITransactionScope = {
      trx: this.database.db,
      afterCommit: [],
      done: false,
      heldLocks: new Set(),
      lastLock: null,
      onceKeys: new Set(),
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

  // Runs `work` the first time `key` comes up in the current transaction and
  // never again in it, e.g. one job that several changes of a transaction
  // each call for. Outside a transaction, every time.
  public async once(key: string, work: () => Promise<unknown>) {
    const scope = currentTransaction();

    if (scope?.onceKeys.has(key)) {
      return;
    }

    scope?.onceKeys.add(key);

    try {
      await work();
    } catch (error) {
      scope?.onceKeys.delete(key);
      throw error;
    }
  }

  // Serializes the transactions that take the same key until they end, e.g.
  // the checks of a per-workspace limit and the insert after them. A lock
  // that comes before the last one taken (compareLocks) throws before any
  // SQL; one already held is a no-op.
  public async lock(lock: IAdvisoryLock) {
    const scope = currentTransaction();

    if (!scope) {
      throw new Error(`lock(${lock.key}) outside a transaction holds nothing`);
    }

    if (scope.heldLocks.has(lock.key)) {
      return;
    }

    if (scope.lastLock && compareLocks(lock, scope.lastLock) < 0) {
      throw new Error(
        `lock(${lock.key}) is out of order: ${scope.lastLock.key} is held`,
      );
    }

    await sql`select pg_advisory_xact_lock(hashtextextended(${lock.key}, 0))`.execute(
      this.database.db,
    );

    scope.heldLocks.add(lock.key);
    scope.lastLock = lock;
  }

  // For work that must run under `lock` and leaves taking it to its caller,
  // who decides what else runs under it.
  public assertHolds(lock: IAdvisoryLock) {
    if (!currentTransaction()?.heldLocks.has(lock.key)) {
      throw new Error(`${lock.key} must be held here`);
    }
  }

  // lock() for each of `locks`, in compareLocks order, the ones not held yet
  // in one statement, which takes them one after another in that order.
  public async lockInOrder(...locks: IAdvisoryLock[]) {
    const scope = currentTransaction();

    if (!scope) {
      throw new Error(
        `lockInOrder(${locks.map(({ key }) => key).join(', ')}) outside a transaction holds nothing`,
      );
    }

    const keys = new Set<string>();
    const toTake = [...locks].sort(compareLocks).filter(({ key }) => {
      const isNew = !scope.heldLocks.has(key) && !keys.has(key);

      keys.add(key);

      return isNew;
    });

    if (!toTake.length) {
      return;
    }

    if (scope.lastLock && compareLocks(toTake[0], scope.lastLock) < 0) {
      throw new Error(
        `lock(${toTake[0].key}) is out of order: ${scope.lastLock.key} is held`,
      );
    }

    if (toTake.length === 1) {
      return this.lock(toTake[0]);
    }

    await sql`
      select pg_advisory_xact_lock(hashtextextended(lock.key, 0))
      from unnest(${toTake.map(({ key }) => key)}::text[])
        with ordinality as lock(key, position)
      order by lock.position
    `.execute(this.database.db);

    toTake.forEach(({ key }) => scope.heldLocks.add(key));
    scope.lastLock = toTake[toTake.length - 1];
  }

  // Lets every statement of the current transaction run up to `seconds`
  // instead of the pool's 10 s (SESSION_SETUP), for background work that
  // is big by nature, such as deleting a workspace with all its data. Ends
  // with the transaction.
  public async allowLongStatements(seconds: number) {
    if (!this.inTransaction) {
      throw new Error(
        'allowLongStatements outside a transaction changes nothing',
      );
    }

    await sql`select set_config('statement_timeout', ${`${seconds}s`}, true)`.execute(
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
