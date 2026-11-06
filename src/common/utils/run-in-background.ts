import { Logger } from '@nestjs/common';

// Slack waits 3 seconds for the answer to an interaction, then shows it as
// failed. Work that can take longer (several queries and Slack calls) runs
// after the answer. Nobody awaits it, so its errors are logged here instead
// of becoming an unhandled rejection that would stop the process.
export const runInBackground = (
  logger: Logger,
  description: string,
  task: () => Promise<unknown>,
) => {
  task().catch((error: Error) => {
    logger.error(`Failed to ${description}: ${error.message}`, error.stack);
  });
};
