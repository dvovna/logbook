import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { trackInBackground } from '@common/utils/run-in-background';

// EventEmitter2.emit starts the listeners (@OnEvent, tab navigation) and
// forgets their promises, so nothing knows they still run: a shutdown would
// cut off a workflow half made, its approvers never asked. emit goes through
// emitAsync instead, and the listeners count as background work, which the
// shutdown and the integration tests wait for.
@Injectable()
export class EventTrackingService implements OnModuleInit {
  private readonly logger = new Logger(EventTrackingService.name);

  public constructor(private readonly eventEmitter: EventEmitter2) {}

  public onModuleInit() {
    const { eventEmitter, logger } = this;

    eventEmitter.emit = (event, ...values) => {
      trackInBackground(
        eventEmitter.emitAsync(event, ...values).catch((error: Error) => {
          // Nest logs a failing @OnEvent listener itself; this is the rest.
          logger.error(
            `Failed to handle ${String(event)}: ${error.message}`,
            error.stack,
          );
        }),
      );

      return eventEmitter.listeners(event).length > 0;
    };
  }
}
