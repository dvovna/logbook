import { AsyncLocalStorage } from 'node:async_hooks';
import { Kysely } from 'kysely';
import { SqlDatabase } from '@common/types/sql-database.types';
import { IAdvisoryLock } from 'src/database/advisory-locks';

export interface ITransactionScope {
  trx: Kysely<SqlDatabase>;
  afterCommit: (() => Promise<unknown>)[];
  // Set once the transaction committed or rolled back. Work started inside it
  // that runs longer (background work inherits the async context) then uses
  // the pool instead of a connection that is no longer in a transaction.
  done: boolean;
  heldLocks: Set<string>;
  lastLock: IAdvisoryLock | null;
}

// The transaction of the current async context: TransactionService starts it,
// DatabaseService hands it to the repositories.
export const transactionScopes = new AsyncLocalStorage<ITransactionScope>();

export const currentTransaction = (): ITransactionScope | null => {
  const scope = transactionScopes.getStore();

  return scope && !scope.done ? scope : null;
};
