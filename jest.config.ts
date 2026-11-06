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
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
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
