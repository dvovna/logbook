import * as Sentry from '@sentry/node';

let enabled = false;

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

export const reportError = (
  error: unknown,
  context: Record<string, unknown> = {},
) => {
  if (!enabled) {
    return;
  }

  Sentry.captureException(error, { extra: context });
};
