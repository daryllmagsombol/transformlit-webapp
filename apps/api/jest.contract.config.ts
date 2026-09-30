import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'test',
  testRegex: String.raw`^(?!.*\.integration\.spec\.ts$).*\.spec\.ts$`,
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@transformlit/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
};

export default config;
