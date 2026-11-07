import { startClock } from './clock';
import { takeSlackViolations } from './slack-violations';

// Each test runs on the fixed clock; beforeAll (the app's start) does not.
beforeEach(() => {
  startClock();
});

afterEach(() => {
  jest.useRealTimers();

  const violations = takeSlackViolations();

  if (violations.length) {
    throw new Error(`Slack would have refused:\n${violations.join('\n')}`);
  }
});
