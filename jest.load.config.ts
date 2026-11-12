import type { Config } from 'jest';

// Same reason as in jest.config.ts: production runs in UTC.
process.env.TZ = 'UTC';

// test/integration/support/test-env.ts overwrites it; load-env.ts puts it back.
if (process.env.DATABASE_POOL_SIZE) {
  process.env.LOAD_DATABASE_POOL_SIZE = process.env.DATABASE_POOL_SIZE;
}

// The load test (`pnpm test:load`): the integration tests' app, fake Slack
// and local Supabase stack, with a company of 400 people and a burst of
// clicks. Not part of `pnpm test:int`. See README → "Load test".
const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/test/load'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.load-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^test/(.*)$': '<rootDir>/test/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@modules/([^/]+)$': '<rootDir>/src/$1/index',
    '^@modules/([^/]+)/(.*)$': '<rootDir>/src/$1/$2',
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
  setupFiles: [
    '<rootDir>/test/integration/support/test-env.ts',
    '<rootDir>/test/load/support/load-env.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/test/integration/support/setup-after-env.ts'],
};

export default config;
