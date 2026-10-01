import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'test',
  testRegex: String.raw`^(?!.*\.integration\.spec\.ts$).*\.spec\.ts$`,
  // `test/scripts/**` holds the PWA harness suite, which uses the Node test
  // runner (`node:test` via `tsx --test`, see the `test:harness` script), not
  // Jest. Collecting it here would fail the contract run.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/scripts/'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@transformlit/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
};

export default config;
