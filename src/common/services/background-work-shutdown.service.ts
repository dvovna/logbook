import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import delay from '@common/utils/delay';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';

// `docker stop` waits 10 seconds before it kills the process.
export const SHUTDOWN_GRACE_MS = 8_000;

// On a deploy the old process gets SIGTERM while it may still be deciding
// approvals, posting notifications or importing a file after it answered
// Slack. It finishes that work first, for a while, then lets the app close.
@Injectable()
export class BackgroundWorkShutdownService
  implements BeforeApplicationShutdown
{
  private readonly logger = new Logger(BackgroundWorkShutdownService.name);

  public async beforeApplicationShutdown(signal?: string) {
    const finished = await Promise.race([
      whenBackgroundWorkIsDone().then(() => true),
      delay(SHUTDOWN_GRACE_MS).then(() => false),
    ]);

    if (!finished) {
      this.logger.warn(
        `Shutting down (${signal ?? 'close'}) with background work still running after ${SHUTDOWN_GRACE_MS} ms`,
      );
    }
  }
}
