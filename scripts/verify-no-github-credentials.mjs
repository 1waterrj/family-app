import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const forbiddenPrefixes = [
  ['gh', 'p_'].join(''),
  ['github', '_pat_'].join(''),
  ['gh', 'o_'].join(''),
  ['gh', 'u_'].join(''),
  ['gh', 'r_'].join(''),
  ['gh', 's_'].join(''),
].map((prefix) => Buffer.from(prefix, 'utf8'));

const scanRoot = parseScanRoot(process.argv.slice(2));
const candidates = scanRoot
  ? listDirectoryFiles(scanRoot)
  : listRepositoryFiles(repositoryRoot);
const offendingPaths = [];

for (const candidate of candidates) {
  const contents = readCandidate(candidate.absolutePath);
  if (forbiddenPrefixes.some((prefix) => contents.includes(prefix))) {
    offendingPaths.push(candidate.displayPath);
  }
}

if (offendingPaths.length > 0) {
  process.stderr.write(
    `GitHub credential prefix found in:\n${offendingPaths.sort().join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write('No GitHub credential prefixes found.\n');

function parseScanRoot(args) {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== '--scan-root') {
    throw new Error(
      'Usage: verify-no-github-credentials.mjs [--scan-root PATH]',
    );
  }
  const root = resolve(args[1]);
  const status = lstatSync(root);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error('The scan root must be a physical directory.');
  }
  return root;
}

function listRepositoryFiles(root) {
  const trackedPaths = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const candidates = trackedPaths.map((trackedPath) => ({
    absolutePath: resolve(root, trackedPath),
    displayPath: trackedPath,
  }));

  for (const artifactRoot of [
    resolve(root, 'apps/parent/dist'),
    resolve(root, 'apps/dashboard/dist'),
  ]) {
    if (!existsSync(artifactRoot)) continue;
    candidates.push(...listDirectoryFiles(artifactRoot, root));
  }
  return uniqueCandidates(candidates);
}

function listDirectoryFiles(root, displayRoot = root) {
  const candidates = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const status = lstatSync(current);
    if (status.isSymbolicLink()) {
      throw new Error(
        `GitHub credential scan refused symbolic link: ${relative(displayRoot, current)}`,
      );
    }
    if (status.isDirectory()) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        pending.push(resolve(current, entry.name));
      }
    } else if (status.isFile()) {
      candidates.push({
        absolutePath: current,
        displayPath: relative(displayRoot, current),
      });
    }
  }
  return candidates;
}

function readCandidate(path) {
  const status = lstatSync(path);
  return status.isSymbolicLink()
    ? Buffer.from(readlinkSync(path), 'utf8')
    : readFileSync(path);
}

function uniqueCandidates(candidates) {
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.absolutePath, candidate]),
    ).values(),
  ];
}
