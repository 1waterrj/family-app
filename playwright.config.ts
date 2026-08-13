import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

process.umask(0o077);
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

type E2eRuntime = {
  databaseUrl: string;
  developmentAuthSecret: string;
  parentApiOrigin: 'http://127.0.0.1:5173';
  dashboardApiOrigin: 'http://127.0.0.1:5173';
};

const repositoryRoot = __dirname;
const runtimePath = resolve(repositoryRoot, '.local/e2e-runtime.json');
const artifactDirectory = resolve(repositoryRoot, '.local/e2e-artifacts');
validateArtifactDirectory(artifactDirectory);
const runtime = readRuntime(runtimePath);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
const sharedServerEnvironment = {
  ...inheritedEnvironment,
  NODE_ENV: 'development',
  DATABASE_URL: runtime.databaseUrl,
  DEVELOPMENT_AUTH_SECRET: runtime.developmentAuthSecret,
  DEV_PARENT_API_ORIGIN: runtime.parentApiOrigin,
  DEV_DASHBOARD_API_ORIGIN: runtime.dashboardApiOrigin,
};
const apiServerEnvironment = {
  ...sharedServerEnvironment,
  FAMILY_FEEDBACK_GITHUB_REPOSITORY: 'family-tests/family-app',
};
const dashboardServerEnvironment = { ...sharedServerEnvironment };
delete dashboardServerEnvironment.FAMILY_FEEDBACK_GITHUB_REPOSITORY;
if ('FAMILY_FEEDBACK_GITHUB_REPOSITORY' in dashboardServerEnvironment) {
  throw new Error(
    'Dashboard E2E environment must not receive feedback repository metadata.',
  );
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  testIgnore: '**/security-artifact-probe.spec.ts',
  outputDir: resolve(artifactDirectory, 'test-results'),
  reporter: [
    [
      'html',
      {
        outputFolder: resolve(artifactDirectory, 'report'),
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: runtime.dashboardApiOrigin,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'pnpm --filter @family/api start',
      url: 'http://127.0.0.1:3000/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      env: apiServerEnvironment,
    },
    {
      command: 'pnpm --filter @family/dashboard dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: dashboardServerEnvironment,
    },
  ],
});

function validateArtifactDirectory(path: string): void {
  try {
    const status = lstatSync(path);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error('artifact path must be a directory, not a link');
    }
    if (realpathSync(path) !== path) {
      throw new Error('artifact directory must not traverse a link');
    }
    if ((status.mode & 0o077) !== 0) {
      throw new Error('artifact directory permissions must be owner-only');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new Error(
      `E2E artifact storage is incomplete: run \`pnpm test:e2e\` so scripts/e2e-prepare.sh can create ${path} (${detail}).`,
      { cause: error },
    );
  }
}

function readRuntime(path: string): E2eRuntime {
  let value: unknown;
  try {
    const linkStatus = lstatSync(path);
    if (!linkStatus.isFile() || linkStatus.isSymbolicLink()) {
      throw new Error('runtime path must be a regular file, not a link');
    }
    if (realpathSync(dirname(path)) !== dirname(path)) {
      throw new Error('runtime directory must not traverse a link');
    }
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error('runtime file permissions must be owner-only');
    }
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new Error(
      `E2E setup is incomplete: run \`pnpm test:e2e\` so scripts/e2e-prepare.sh can create ${path} (${detail}).`,
      { cause: error },
    );
  }

  if (!isRecord(value)) return invalidRuntime(path);
  if (
    Object.keys(value).sort().join(',') !==
    'dashboardApiOrigin,databaseUrl,developmentAuthSecret,parentApiOrigin'
  ) {
    return invalidRuntime(path);
  }
  if (
    value.databaseUrl !== 'postgres://family:family@127.0.0.1:54329/family' ||
    typeof value.developmentAuthSecret !== 'string' ||
    Buffer.byteLength(value.developmentAuthSecret, 'utf8') < 32 ||
    value.parentApiOrigin !== 'http://127.0.0.1:5173' ||
    value.dashboardApiOrigin !== 'http://127.0.0.1:5173'
  ) {
    return invalidRuntime(path);
  }
  return value as E2eRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRuntime(path: string): never {
  throw new Error(
    `E2E setup is incomplete: ${path} is malformed; rerun scripts/e2e-prepare.sh.`,
  );
}
