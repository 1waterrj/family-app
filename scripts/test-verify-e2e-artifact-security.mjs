#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fakeBin = mkdtempSync(resolve(tmpdir(), 'family-e2e-probe-test-'));
const fakePnpm = resolve(fakeBin, 'pnpm');
const capturePath = resolve(fakeBin, 'sentinel.txt');
const probeRoot = resolve(
  repositoryRoot,
  '.local/e2e-artifacts/security-probe',
);

writeFileSync(
  fakePnpm,
  `#!/usr/bin/env node
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const probeRoot = resolve(process.cwd(), '.local/e2e-artifacts/security-probe');
const reportPath = resolve(probeRoot, 'report.json');
const markerPath =
  process.env.FAMILY_E2E_SECURITY_PROBE_COMPLETION_MARKER ??
  resolve(probeRoot, 'completion-marker.json');
const scenario = process.env.FAMILY_E2E_SECURITY_PROBE_FAKE_SCENARIO;
const expectedError =
  'Error: Intentional E2E artifact security probe failure after credential fill.';
mkdirSync(probeRoot, { recursive: true, mode: 0o700 });
writeFileSync(
  process.env.FAMILY_E2E_SECURITY_PROBE_FAKE_SENTINEL_CAPTURE,
  process.env.FAMILY_E2E_SECURITY_SENTINEL,
  { mode: 0o600 },
);

const makeResultError = (message) => ({ message, stack: message });
const makeReport = (message = expectedError) => ({
  suites: [
    {
      title: 'security-artifact-probe.spec.ts',
      file: 'security-artifact-probe.spec.ts',
      specs: [
        {
          title: 'credential-bearing browser actions do not persist their value',
          ok: false,
          tests: [
            {
              expectedStatus: 'passed',
              results: [
                {
                  status: 'failed',
                  error: makeResultError(message),
                  errors: [makeResultError(\`\${message}\\n\\n  1 | throw new Error(...)\`)],
                  retry: 0,
                },
              ],
              status: 'unexpected',
            },
          ],
          file: 'security-artifact-probe.spec.ts',
        },
      ],
    },
  ],
  errors: [],
  stats: { expected: 0, skipped: 0, unexpected: 1, flaky: 0 },
});
const writeMarker = (mode = 0o600) =>
  writeFileSync(markerPath, '{"status":"credential-filled"}\\n', { mode });
const writeReport = (report = makeReport(), mode = 0o600) =>
  writeFileSync(reportPath, JSON.stringify(report), { mode });

switch (scenario) {
  case 'expected':
    writeMarker();
    writeReport();
    break;
  case 'pre-fill-failure':
    writeReport(makeReport('Error: browser launch failed'));
    break;
  case 'missing-report':
    writeMarker();
    break;
  case 'malformed-report':
    writeMarker();
    writeFileSync(reportPath, '{', { mode: 0o600 });
    break;
  case 'extra-tests': {
    writeMarker();
    const report = makeReport();
    report.suites[0].specs.push(report.suites[0].specs[0]);
    writeReport(report);
    break;
  }
  case 'wrong-error':
    writeMarker();
    writeReport(makeReport('Error: unrelated failure'));
    break;
  case 'extra-errors': {
    writeMarker();
    const report = makeReport();
    report.suites[0].specs[0].tests[0].results[0].errors.push(
      makeResultError('Error: unrelated second failure'),
    );
    writeReport(report);
    break;
  }
  case 'missing-marker':
    writeReport();
    break;
  case 'malformed-marker':
    writeMarker();
    writeFileSync(markerPath, '{"status":"before-fill"}\\n', { mode: 0o600 });
    writeReport();
    break;
  case 'marker-symlink': {
    const target = resolve(probeRoot, 'marker-target');
    writeFileSync(target, '{"status":"credential-filled"}\\n', { mode: 0o600 });
    symlinkSync(target, markerPath);
    writeReport();
    break;
  }
  case 'marker-permissive':
    writeMarker(0o644);
    chmodSync(markerPath, 0o644);
    writeReport();
    break;
  case 'report-symlink': {
    writeMarker();
    const target = resolve(probeRoot, 'report-target.json');
    writeFileSync(target, JSON.stringify(makeReport()), { mode: 0o600 });
    symlinkSync(target, reportPath);
    break;
  }
  case 'report-permissive':
    writeMarker();
    writeReport(makeReport(), 0o644);
    chmodSync(reportPath, 0o644);
    break;
  case 'zero-exit':
    writeMarker();
    writeReport();
    process.exit(0);
  default:
    throw new Error('Unknown fake security-probe scenario.');
}

process.exit(1);
`,
  { mode: 0o700 },
);
chmodSync(fakePnpm, 0o700);

const scenarios = [
  ['expected', 0],
  ['pre-fill-failure', 1],
  ['missing-report', 1],
  ['malformed-report', 1],
  ['extra-tests', 1],
  ['wrong-error', 1],
  ['extra-errors', 1],
  ['missing-marker', 1],
  ['malformed-marker', 1],
  ['marker-symlink', 1],
  ['marker-permissive', 1],
  ['report-symlink', 1],
  ['report-permissive', 1],
  ['zero-exit', 1],
];

try {
  for (const [scenario, expectedStatus] of scenarios) {
    rmSync(capturePath, { force: true });
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/verify-e2e-artifact-security.mjs')],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
          FAMILY_E2E_SECURITY_PROBE_FAKE_SCENARIO: scenario,
          FAMILY_E2E_SECURITY_PROBE_FAKE_SENTINEL_CAPTURE: capturePath,
        },
      },
    );
    if (result.status !== expectedStatus) {
      throw new Error(
        `Verifier scenario ${scenario} exited ${String(result.status)} instead of ${String(expectedStatus)}.`,
      );
    }
    const sentinel = readFileSync(capturePath, 'utf8');
    if (`${result.stdout}${result.stderr}`.includes(sentinel)) {
      throw new Error(`Verifier scenario ${scenario} disclosed its sentinel.`);
    }
    if (existsSync(probeRoot)) {
      throw new Error(
        `Verifier scenario ${scenario} left probe artifacts behind.`,
      );
    }
  }
} finally {
  rmSync(fakeBin, { recursive: true, force: true });
  rmSync(probeRoot, { recursive: true, force: true });
}

process.stdout.write(
  'E2E artifact verifier self-test passed (14 scenarios).\n',
);
