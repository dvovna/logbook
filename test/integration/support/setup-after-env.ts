import { startClock } from './clock';
import { takeSlackViolations } from './slack-violations';

// Here rather than as `testTimeout` in jest.integration.config.ts: Jest reads
// that option only from the top-level config, so it would be lost when the
// suite runs as a project of jest.coverage.config.ts (`pnpm test:cov:all`).
jest.setTimeout(30_000);

// Each test runs on the fixed clock; beforeAll (the app's start) does not.
beforeEach(() => {
  startClock();
});

afterEach(() => {
  jest.useRealTimers();

  const violations = takeSlackViolations();

  if (violations.length) {
    throw new Error(
      `Slack would have refused or shown wrongly:\n${violations.join('\n')}`,
    );
  }
});
