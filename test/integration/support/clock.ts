// Every test starts at this moment: a Wednesday in the middle of a month,
// away from the edges of a week, month or year. The app runs in the test's
// process, so "today" is the same for both and does not depend on when the
// tests run.
export const TEST_NOW = new Date('2026-06-17T09:00:00Z');

// Only Date is faked; timers, I/O and the event loop stay real, and the
// clock keeps running from the moment it was set.
const NOT_FAKED = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

export const startClock = () =>
  jest.useFakeTimers({
    now: TEST_NOW,
    advanceTimers: true,
    doNotFake: [...NOT_FAKED],
  });

// Moves the clock to 9:00 UTC of `date` (YYYY-MM-DD) for the rest of the
// test, e.g. to a Monday to test what "this week" means.
export const travelTo = (date: string) =>
  jest.setSystemTime(new Date(`${date}T09:00:00Z`));
