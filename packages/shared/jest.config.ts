export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testRegex: String.raw`.*\.spec\.ts$`,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/types/**'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 95,
      branches: 90,
      functions: 95,
      statements: 95,
    },
  },
};
