import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  APPROVERS_CHANGED,
  ApproversChangedEvent,
} from '@modules/users/events/users.events';
import { TransactionService } from 'src/database/transaction.service';

// Someone may now approve the requests of the workspace that waited for
// anyone who could: the listener saves the job that starts them in the
// caller's transaction (emitAsync).
export const publishApproversChanged = (
  eventEmitter: EventEmitter2,
  slackTeamId: string,
) =>
  eventEmitter.emitAsync(
    APPROVERS_CHANGED,
    new ApproversChangedEvent(slackTeamId),
  );

// Runs `write`; when it names someone as an approver who wasn't, in one
// transaction with publishApproversChanged, so the job is saved with the
// change. Any other write runs as it is.
export const writeNamingApprovers = <T>(
  {
    transactions,
    eventEmitter,
  }: { transactions: TransactionService; eventEmitter: EventEmitter2 },
  slackTeamId: string,
  namesSomeoneNew: boolean,
  write: () => Promise<T>,
): Promise<T> =>
  namesSomeoneNew
    ? transactions.transaction(async () => {
        const result = await write();

        await publishApproversChanged(eventEmitter, slackTeamId);

        return result;
      })
    : write();

// Whether `after` lists someone `before` doesn't.
export const namesSomeoneNew = (
  before: readonly string[] | null | undefined,
  after: readonly string[] | null | undefined,
) => (after ?? []).some((slackId) => !(before ?? []).includes(slackId));
