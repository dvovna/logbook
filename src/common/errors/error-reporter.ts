import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Sentry from '@sentry/node';

let enabled = false;

// `logbook@0.3.0`, so that an issue names the version that brought it.
// package.json is three levels up from both src/common/errors and
// dist/common/errors, and the Docker image keeps it next to dist.
export const appRelease = (): string | undefined => {
  try {
    const { name, version } = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    ) as { name: string; version: string };

    return `${name}@${version}`;
  } catch {
    return undefined;
  }
};

// Unexpected errors go to Sentry when SENTRY_DSN is set. Without it, the
// default for people who self-host, nothing leaves the server and errors are
// only logged.
export const initErrorReporting = (env = process.env) => {
  if (!env.SENTRY_DSN) {
    return false;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: appRelease(),
    // The error and its stack only. Slack requests carry people's names,
    // comments and IDs, so no request data, users, cookies, query strings,
    // queue payloads or local variables are sent, and there is no tracing.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  });
  enabled = true;

  return true;
};

// Sends what is still queued, before the process exits.
export const flushErrorReports = (timeoutMs = 2000): Promise<boolean> =>
  enabled ? Sentry.flush(timeoutMs) : Promise.resolve(true);

export const reportError = (
  error: unknown,
  context: Record<string, unknown> = {},
) => {
  if (!enabled) {
    return;
  }

  Sentry.captureException(error, { extra: context });
};
