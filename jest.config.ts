import type { Config } from 'jest';

// Date logic mixes local getters (getDay) with toISOString(); pin the timezone
// to UTC so tests behave like production (the Docker image runs in UTC).
process.env.TZ = 'UTC';

const config: Config = {
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // Mirrors the tsconfig paths: `src/...`, `@common/*` and `@modules/<module>[/*]`.
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@modules/([^/]+)$': '<rootDir>/$1/index',
    '^@modules/([^/]+)/(.*)$': '<rootDir>/$1/$2',
  },
  testEnvironment: 'node',
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!common/types/database.types.ts',
  ],
  coverageDirectory: '../coverage',
};

export default config;
