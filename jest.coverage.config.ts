import type { Config } from 'jest';

// Coverage of the unit and integration tests together (`pnpm test:cov:all`).
// Each suite alone shows only part of it: unit tests build services with mocks
// and leave the Slack UI out, integration tests replace the Slack and Nager.Date
// clients. Jest runs both projects in one process and merges their coverage.
// The integration project needs the local Supabase stack, as for `pnpm test:int`.
const config: Config = {
  rootDir: '.',
  projects: [
    '<rootDir>/jest.config.ts',
    '<rootDir>/jest.integration.config.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/common/types/database.types.ts',
    // Dev scripts, not part of the build.
    '!src/commands/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  // A summary in the terminal, a browsable report in coverage/index.html and
  // coverage/lcov.info for the IDE.
  coverageReporters: ['text-summary', 'html', 'lcovonly'],
};

export default config;
