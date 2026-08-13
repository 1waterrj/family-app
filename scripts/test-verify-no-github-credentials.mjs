import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';

process.umask(0o077);

const repositoryRoot = resolve(import.meta.dirname, '..');
const scannerPath = resolve(
  repositoryRoot,
  'scripts/verify-no-github-credentials.mjs',
);
const fixtureRoot = mkdtempSync(
  resolve(tmpdir(), 'family-github-credential-scan-'),
);
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

if ((statSync(fixtureRoot).mode & 0o077) !== 0) {
  throw new Error('The scanner fixture directory must be owner-only.');
}

const forbiddenPrefixes = [
  ['gh', 'p_'].join(''),
  ['github', '_pat_'].join(''),
  ['gh', 'o_'].join(''),
  ['gh', 'u_'].join(''),
  ['gh', 'r_'].join(''),
  ['gh', 's_'].join(''),
];
const candidatePath = resolve(fixtureRoot, 'candidate.txt');

for (const prefix of forbiddenPrefixes) {
  const candidate = `${prefix}${'A1b2'.repeat(12)}`;
  writeFileSync(candidatePath, `${candidate}\n`, { mode: 0o600 });
  const result = runScanner();
  if (result.status === 0) {
    throw new Error(
      `Scanner accepted forbidden prefix family ${prefix.length}.`,
    );
  }
  if (
    !result.stderr.includes('GitHub credential prefix found') ||
    !result.stderr.includes('candidate.txt')
  ) {
    throw new Error(`Scanner did not report the controlled fixture path.`);
  }
  if (result.stderr.includes(candidate) || result.stdout.includes(candidate)) {
    throw new Error('Scanner output leaked the credential-shaped fixture.');
  }
}

writeFileSync(
  candidatePath,
  [
    'https://github.com/family-tests/family-app',
    'https://github.com/family-tests/family-app/issues/new',
    'FAMILY_FEEDBACK_GITHUB_REPOSITORY=family-tests/family-app',
  ].join('\n'),
  { mode: 0o600 },
);
const safeResult = runScanner();
if (safeResult.status !== 0) {
  throw new Error(
    `Scanner rejected public repository metadata: ${safeResult.stderr}`,
  );
}
if (safeResult.stdout !== 'No GitHub credential prefixes found.\n') {
  throw new Error('Scanner did not report a successful clean scan.');
}

process.stdout.write(
  'GitHub credential scanner self-test passed (7 scenarios).\n',
);

function runScanner() {
  return spawnSync(
    process.execPath,
    [scannerPath, '--scan-root', fixtureRoot],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
}
