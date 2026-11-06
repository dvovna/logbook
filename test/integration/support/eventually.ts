// Slack gets its 3-second acknowledgement first, the work happens afterwards
// (event handlers, EventEmitter listeners), so most effects show up a moment
// after the response. Retries `check` until it stops throwing.
export const eventually = async <T>(
  check: () => T | Promise<T>,
  { timeout = 5_000, interval = 50 } = {},
): Promise<T> => {
  const deadline = Date.now() + timeout;

  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
};

// For asserting that something did *not* happen: give background work time
// to run first.
export const settle = (ms = 300) =>
  new Promise((resolve) => setTimeout(resolve, ms));
