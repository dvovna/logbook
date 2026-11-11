// How long a SIGTERM may take before the process exits, by step. Docker
// kills the process after its stop grace period (stop_grace_period in
// docker-compose.yml; `docker stop` alone waits 10 s), and platforms such as
// Render and Fly after their own: it must be longer than the sum.

// Requests in flight, then the background work and the job runs they started
// (BackgroundWorkShutdownService).
export const SHUTDOWN_GRACE_MS = 12_000;

// Then pg-boss (JobsService) and the app's pool (DatabaseService) close,
// each waiting at most this long for its queries in flight.
export const CLOSE_TIMEOUT_MS = 5_000;

export const SHUTDOWN_BUDGET_MS = SHUTDOWN_GRACE_MS + 2 * CLOSE_TIMEOUT_MS;
