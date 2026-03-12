import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__integration__/**/*.test.ts'],
  globalSetup:    '<rootDir>/jest.globalSetup.ts',
  globalTeardown: '<rootDir>/jest.globalTeardown.ts',
  // Integration tests need time for container startup on first run
  testTimeout: 30000,
  // Run sequentially — tests share containers and must not race on DB state
  runInBand: true,
};

export default config;
