import { flushErrorReports, reportError } from '@common/errors/error-reporter';
import { isShuttingDown } from '@common/utils/shutdown-state';

// A deploy or a restart can stop the process while it is still starting: the
// shutdown hooks close the pool under the startup's queries, which then fail.
// That is the process ending as asked, and the hooks exit it. Any other
// failure stops the process: a rejection left unhandled would only be logged
// once Sentry listens for them, and the app would hang without a port.
export const handleStartupFailure = async (
  error: unknown,
  exit: (code: number) => void = (code) => process.exit(code),
) => {
  if (isShuttingDown()) {
    return;
  }

  console.error('Logbook could not start:', error);
  reportError(error, { task: 'start the app' });
  await flushErrorReports();
  exit(1);
};
