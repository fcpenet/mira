import path from 'path';
import type { Config } from 'jest';

const config: Config = {
  // Anchor rootDir to the project root so <rootDir> works correctly
  // regardless of where this config file lives.
  rootDir: path.resolve(__dirname, '..'),
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.test.ts'],
  globalSetup:    '<rootDir>/integration/globalSetup.ts',
  globalTeardown: '<rootDir>/integration/globalTeardown.ts',
  // Integration tests need time for container startup on first run
  testTimeout: 30000,
  // Run sequentially — tests share containers and must not race on DB state
  runInBand: true,
};

export default config;
