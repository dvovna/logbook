import { startClock } from './clock';

// Each test runs on the fixed clock; beforeAll (the app's start) does not.
beforeEach(() => {
  startClock();
});

afterEach(() => {
  jest.useRealTimers();
});
