import { Logger } from '@nestjs/common';

interface IPeriodicOptions {
  firstAfterMs: number;
  everyMs: number;
  logger: Logger;
  // What failed, for the log: "Could not sync the members".
  failure: string;
}

// Runs `task` `firstAfterMs` after the start, then every `everyMs`. A failed
// run is logged and the next one tries again. The timers alone don't keep
// the process running (unref). Returns what stops them, for
// onModuleDestroy.
export const runPeriodically = (
  task: () => Promise<unknown>,
  { firstAfterMs, everyMs, logger, failure }: IPeriodicOptions,
): (() => void) => {
  const run = () => {
    task().catch((error: Error) =>
      logger.error(`${failure}: ${error.message}`),
    );
  };
  const timers = [
    setTimeout(run, firstAfterMs).unref(),
    setInterval(run, everyMs).unref(),
  ];

  return () => timers.forEach((timer) => clearTimeout(timer));
};
