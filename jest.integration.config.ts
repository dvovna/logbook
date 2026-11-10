import type { Config } from 'jest';

// Same reason as in jest.config.ts: production runs in UTC.
process.env.TZ = 'UTC';

// Integration tests run the whole app against the local Supabase stack, with
// only the Slack Web API replaced by a fake. See README → "Integration tests".
const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/test/integration'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@modules/([^/]+)$': '<rootDir>/src/$1/index',
    '^@modules/([^/]+)/(.*)$': '<rootDir>/src/$1/$2',
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/integration/support/test-env.ts'],
  // Sets the test timeout too: Jest ignores `testTimeout` in a project config,
  // and this suite also runs as a project of jest.coverage.config.ts.
  setupFilesAfterEnv: ['<rootDir>/test/integration/support/setup-after-env.ts'],
};

export default config;
