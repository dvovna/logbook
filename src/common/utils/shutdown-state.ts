let shuttingDown = false;

// Set by the first shutdown hook (BackgroundWorkShutdownService), before
// anything closes.
export const markShuttingDown = () => {
  shuttingDown = true;
};

export const isShuttingDown = () => shuttingDown;
