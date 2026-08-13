import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';

process.umask(0o077);

const repositoryRoot = resolve(import.meta.dirname, '..');
const scannerPath = resolve(
  repositoryRoot,
  'scripts/verify-no-credential-leaks.mjs',
);
const fixtureRoot = mkdtempSync(
  resolve(tmpdir(), 'family-credential-leak-scan-'),
);
const parentToken = 'synthetic-parent-access-token';
const dashboardToken = 'synthetic-dashboard-access-token';
const tokens = [parentToken, dashboardToken];
const trackedPath = resolve(fixtureRoot, 'tracked.txt');
const cleanDistPath = resolve(fixtureRoot, 'apps/parent/dist/clean.txt');
const generatedLeakPath = resolve(fixtureRoot, 'apps/dashboard/dist/leak.txt');
const traversalLinkPath = resolve(
  fixtureRoot,
  'apps/dashboard/dist/linked.txt',
);
let scenarioCount = 0;

chmodSync(fixtureRoot, 0o700);

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(fixtureRoot, { force: true, recursive: true });
}
process.once('exit', cleanup);
for (const [signal, exitCode] of [
  ['SIGHUP', 129],
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.once(signal, () => {
    cleanup();
    process.exit(exitCode);
  });
}

runGit(['init']);
writeFileSync(trackedPath, 'Tracked public content.\n', { mode: 0o600 });
runGit(['add', 'tracked.txt']);
writeCredentialFixtures();
mkdirSync(resolve(fixtureRoot, 'apps/parent/dist'), {
  mode: 0o700,
  recursive: true,
});
mkdirSync(resolve(fixtureRoot, 'apps/dashboard/dist'), {
  mode: 0o700,
  recursive: true,
});
writeFileSync(cleanDistPath, 'Clean generated asset.\n', { mode: 0o600 });

assertClean(runScanner(), 'a clean generated dist tree');
scenarioCount += 1;

writeFileSync(generatedLeakPath, `${parentToken}\n`, { mode: 0o600 });
assertFinding(
  runScanner(),
  'apps/dashboard/dist/leak.txt',
  'a generated dist credential',
);
scenarioCount += 1;

unlinkSync(generatedLeakPath);
assertClean(runScanner(), 'a clean generated dist tree after cleanup');
scenarioCount += 1;

writeFileSync(resolve(fixtureRoot, 'outside.txt'), 'outside\n', {
  mode: 0o600,
});
symlinkSync(resolve(fixtureRoot, 'outside.txt'), traversalLinkPath);
assertFinding(
  runScanner(),
  'apps/dashboard/dist/linked.txt',
  'a generated dist traversal link',
);
scenarioCount += 1;

process.stdout.write(
  `Credential leak scanner self-test passed (${scenarioCount} controlled scenarios).\n`,
);

function writeCredentialFixtures() {
  const fixtureDirectory = resolve(fixtureRoot, '.local/dev-fixtures');
  mkdirSync(fixtureDirectory, { mode: 0o700, recursive: true });
  writeFileSync(
    resolve(fixtureDirectory, 'parent.json'),
    `${JSON.stringify({ accessToken: parentToken })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    resolve(fixtureDirectory, 'dashboard.json'),
    `${JSON.stringify({ accessToken: dashboardToken })}\n`,
    { mode: 0o600 },
  );
}

function runScanner() {
  return spawnSync(
    process.execPath,
    [scannerPath, '--scan-root', fixtureRoot],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
    },
  );
}

function assertClean(result, scenario) {
  if (result.status !== 0 || result.stdout !== '' || result.stderr !== '') {
    throw new Error(`Scanner rejected ${scenario}.`);
  }
}

function assertFinding(result, expectedPath, scenario) {
  if (result.status === 0 || !result.stderr.includes(expectedPath)) {
    throw new Error(`Scanner did not reject ${scenario}.`);
  }
  const output = `${result.stdout}${result.stderr}`;
  if (tokens.some((token) => output.includes(token))) {
    throw new Error(`Scanner leaked a generated credential for ${scenario}.`);
  }
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Fixture Git setup failed: ${args[0]}.`);
  }
}
