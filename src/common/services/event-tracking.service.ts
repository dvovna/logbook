import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { trackInBackground } from '@common/utils/run-in-background';
import { TransactionService } from 'src/database/transaction.service';

// EventEmitter2.emit starts the listeners (@OnEvent, tab navigation) and
// forgets their promises, so nothing knows they still run: a shutdown would
// cut off a workflow half made, its approvers never asked. emit goes through
// emitAsync instead, and the listeners count as background work, which the
// shutdown and the integration tests wait for.
//
// An event emitted inside a transaction reaches its listeners once the
// transaction has committed, and never when it rolls back: a listener started
// inside would run on the transaction's connection, on data that may still
// go away.
@Injectable()
export class EventTrackingService implements OnModuleInit {
  private readonly logger = new Logger(EventTrackingService.name);

  public constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly transactions: TransactionService,
  ) {}

  public onModuleInit() {
    const { eventEmitter, logger, transactions } = this;

    eventEmitter.emit = (event, ...values) => {
      const handle = () =>
        eventEmitter.emitAsync(event, ...values).catch((error: Error) => {
          // Nest logs a failing @OnEvent listener itself; this is the rest.
          logger.error(
            `Failed to handle ${String(event)}: ${error.message}`,
            error.stack,
          );
        });

      if (transactions.inTransaction) {
        transactions.afterCommit(handle);
      } else {
        trackInBackground(handle());
      }

      return eventEmitter.listeners(event).length > 0;
    };
  }
}
