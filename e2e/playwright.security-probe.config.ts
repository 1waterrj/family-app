import { resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

import familyE2eConfig from '../playwright.config';

const artifactDirectory = resolve(
  __dirname,
  '../.local/e2e-artifacts/security-probe',
);

export default defineConfig({
  ...familyE2eConfig,
  testDir: __dirname,
  testMatch: 'security-artifact-probe.spec.ts',
  testIgnore: [],
  outputDir: resolve(artifactDirectory, 'test-results'),
  reporter: [
    ['json', { outputFile: resolve(artifactDirectory, 'report.json') }],
  ],
  webServer: undefined,
});
