import * as Sentry from '@sentry/node';
import {
  appRelease,
  initErrorReporting,
  reportError,
} from '@common/errors/error-reporter';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { version: string };

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

// The module keeps whether reporting is on, so the order matters here.
describe('error reporting', () => {
  it('names the release after the package', () => {
    expect(appRelease()).toBe(`logbook@${version}`);
  });

  it('stays off without SENTRY_DSN and sends nothing', () => {
    expect(initErrorReporting({})).toBe(false);

    reportError(new Error('boom'));

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends errors to Sentry, without people data, once SENTRY_DSN is set', () => {
    expect(
      initErrorReporting({
        SENTRY_DSN: 'https://key@sentry.example/1',
        NODE_ENV: 'production',
      }),
    ).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example/1',
        environment: 'production',
        release: `logbook@${version}`,
        dataCollection: expect.objectContaining({
          userInfo: false,
          httpBodies: [],
          httpHeaders: false,
        }),
      }),
    );

    const error = new Error('boom');
    reportError(error, { task: 'approve step' });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      extra: { task: 'approve step' },
    });
  });
});
