#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const artifactDirectory = resolve(
  repositoryRoot,
  '.local/e2e-artifacts/security-probe',
);
const artifactRoot = resolve(repositoryRoot, '.local/e2e-artifacts');
const completionMarkerPath = resolve(
  artifactDirectory,
  'completion-marker.json',
);
const reportPath = resolve(artifactDirectory, 'report.json');
const expectedProbeError =
  'Error: Intentional E2E artifact security probe failure after credential fill.';
const expectedCompletionMarker = '{"status":"credential-filled"}\n';
const sentinel = `non-secret-e2e-probe-${randomBytes(24).toString('hex')}`;

const artifactRootStatus = lstatSync(artifactRoot);
if (
  !artifactRootStatus.isDirectory() ||
  artifactRootStatus.isSymbolicLink() ||
  realpathSync(artifactRoot) !== artifactRoot ||
  (artifactRootStatus.mode & 0o077) !== 0
) {
  process.stderr.write(
    'E2E artifact security verification failed: artifact root is not an owner-only physical directory.\n',
  );
  process.exit(1);
}

rmSync(artifactDirectory, { recursive: true, force: true });
mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
chmodSync(artifactDirectory, 0o700);

let problem;
try {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config=e2e/playwright.security-probe.config.ts',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        FAMILY_E2E_SECURITY_PROBE_COMPLETION_MARKER: completionMarkerPath,
        FAMILY_E2E_SECURITY_SENTINEL: sentinel,
      },
    },
  );

  if (result.error) {
    problem = `could not run the Playwright security probe (${result.error.message})`;
  } else if (result.status === 0) {
    problem = 'the intentionally failing Playwright security probe passed';
  } else if (result.status !== 1) {
    problem = 'the Playwright security probe exited abnormally';
  } else {
    problem = inspectArtifactTree(artifactDirectory, sentinel);
    problem ??= inspectCompletionMarker(completionMarkerPath);
    problem ??= inspectProbeReport(reportPath);
  }
} finally {
  rmSync(artifactDirectory, { recursive: true, force: true });
}

if (problem) {
  process.stderr.write(
    `E2E artifact security verification failed: ${problem.replaceAll(sentinel, '[redacted]')}.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  'E2E browser artifacts are credential-free and owner-only.\n',
);

function inspectArtifactTree(root, forbiddenValue) {
  const paths = [root];

  while (paths.length > 0) {
    const path = paths.pop();
    const status = lstatSync(path);
    if (status.isSymbolicLink())
      return `artifact path is a symbolic link: ${path}`;
    if ((status.mode & 0o077) !== 0) {
      return `artifact path is accessible beyond its owner: ${path}`;
    }
    if (status.isDirectory()) {
      for (const entry of readdirSync(path)) paths.push(resolve(path, entry));
      continue;
    }
    if (!status.isFile()) return `artifact path is not a regular file: ${path}`;
    if (path.endsWith('/trace.zip'))
      return `a Playwright trace was retained: ${path}`;
    if (readFileSync(path).includes(Buffer.from(forbiddenValue))) {
      return `the non-secret credential sentinel was serialized: ${path}`;
    }
  }

  return undefined;
}

function inspectCompletionMarker(path) {
  const pathProblem = inspectOwnerOnlyRegularFile(path, 'completion marker');
  if (pathProblem) return pathProblem;
  if (readFileSync(path, 'utf8') !== expectedCompletionMarker) {
    return 'the completion marker is malformed';
  }
  return undefined;
}

function inspectProbeReport(path) {
  const pathProblem = inspectOwnerOnlyRegularFile(path, 'report');
  if (pathProblem) return pathProblem;

  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return 'the probe report is malformed';
  }

  if (!isRecord(report)) return 'the probe report is malformed';
  if (!Array.isArray(report.errors) || report.errors.length !== 0) {
    return 'the probe report contains runner-level errors';
  }
  if (!Array.isArray(report.suites) || report.suites.length !== 1) {
    return 'the probe report did not contain exactly one suite';
  }

  const suite = report.suites[0];
  if (
    !isRecord(suite) ||
    suite.title !== 'security-artifact-probe.spec.ts' ||
    suite.file !== 'security-artifact-probe.spec.ts' ||
    !Array.isArray(suite.specs) ||
    suite.specs.length !== 1 ||
    (suite.suites !== undefined &&
      (!Array.isArray(suite.suites) || suite.suites.length !== 0))
  ) {
    return 'the probe report did not contain exactly one expected test file';
  }

  const spec = suite.specs[0];
  if (
    !isRecord(spec) ||
    spec.title !==
      'credential-bearing browser actions do not persist their value' ||
    spec.file !== 'security-artifact-probe.spec.ts' ||
    spec.ok !== false ||
    !Array.isArray(spec.tests) ||
    spec.tests.length !== 1
  ) {
    return 'the probe report did not contain exactly one expected test';
  }

  const probeTest = spec.tests[0];
  if (
    !isRecord(probeTest) ||
    probeTest.expectedStatus !== 'passed' ||
    probeTest.status !== 'unexpected' ||
    !Array.isArray(probeTest.results) ||
    probeTest.results.length !== 1
  ) {
    return 'the expected probe test did not fail exactly once';
  }

  const result = probeTest.results[0];
  if (
    !isRecord(result) ||
    result.status !== 'failed' ||
    result.retry !== 0 ||
    !isExpectedError(result.error) ||
    !Array.isArray(result.errors) ||
    result.errors.length !== 1 ||
    !isExpectedContextualError(result.errors[0])
  ) {
    return 'the probe test did not fail with only the expected post-fill error';
  }

  const stats = report.stats;
  if (
    !isRecord(stats) ||
    stats.expected !== 0 ||
    stats.skipped !== 0 ||
    stats.unexpected !== 1 ||
    stats.flaky !== 0
  ) {
    return 'the probe report test counts are invalid';
  }

  return undefined;
}

function inspectOwnerOnlyRegularFile(path, label) {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    return `the probe did not produce its expected ${label}`;
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    return `the probe ${label} is not a physical regular file`;
  }
  if ((status.mode & 0o077) !== 0) {
    return `the probe ${label} is accessible beyond its owner`;
  }
  return undefined;
}

function isExpectedError(value) {
  return isRecord(value) && value.message === expectedProbeError;
}

function isExpectedContextualError(value) {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    (value.message === expectedProbeError ||
      value.message.startsWith(`${expectedProbeError}\n\n`))
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
