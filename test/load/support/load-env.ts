// Runs after test/integration/support/test-env.ts, which gives every
// integration test file a pool of 5 because they run at once. Here one app
// runs alone, with production's defaults (src/env.schema.ts) unless the
// command line names others: `DATABASE_POOL_SIZE=20 pnpm test:load`.
// jest.load.config.ts keeps the command line's value in LOAD_DATABASE_POOL_SIZE,
// since test-env.ts overwrites DATABASE_POOL_SIZE.
process.env.DATABASE_POOL_SIZE = process.env.LOAD_DATABASE_POOL_SIZE ?? '10';
process.env.JOBS_CONCURRENCY ??= '4';
