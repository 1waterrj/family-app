import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');

function main() {
  let root;
  try {
    root = parseScanRoot(process.argv.slice(2));
  } catch {
    printSafeFailure('Credential scanner received invalid arguments.');
    return;
  }

  let tokens;
  try {
    tokens = loadGeneratedTokens(root);
  } catch {
    process.stderr.write(
      'Generated development credentials are unavailable; run pnpm test:e2e first.\n',
    );
    process.exitCode = 1;
    return;
  }

  let candidates;
  try {
    candidates = listCandidates(root);
  } catch {
    printSafeFailure('Credential scanner could not enumerate tracked files.');
    return;
  }

  const offendingPaths = new Set();
  for (const candidate of candidates) {
    let contents;
    try {
      const status = lstatSync(candidate.absolutePath);
      if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error('candidate is not a physical regular file');
      }
      contents = readFileSync(candidate.absolutePath);
    } catch {
      offendingPaths.add(candidate.displayPath);
      continue;
    }
    if (tokens.some((token) => contents.includes(token))) {
      offendingPaths.add(candidate.displayPath);
    }
  }

  if (offendingPaths.size > 0) {
    process.stderr.write(`${[...offendingPaths].sort().join('\n')}\n`);
    process.exitCode = 1;
  }
}

function parseScanRoot(args) {
  let root = repositoryRoot;
  if (args.length > 0) {
    if (
      args.length !== 2 ||
      args[0] !== '--scan-root' ||
      args[1].length === 0
    ) {
      throw new Error('invalid arguments');
    }
    root = resolve(args[1]);
  }
  const status = lstatSync(root);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error('scan root must be a physical directory');
  }
  return root;
}

function loadGeneratedTokens(root) {
  return [
    resolve(root, '.local/dev-fixtures/parent.json'),
    resolve(root, '.local/dev-fixtures/dashboard.json'),
  ].map((credentialPath) => {
    const status = lstatSync(credentialPath);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new Error('credential is not a physical regular file');
    }
    const credential = JSON.parse(readFileSync(credentialPath, 'utf8'));
    if (
      typeof credential !== 'object' ||
      credential === null ||
      typeof credential.accessToken !== 'string' ||
      credential.accessToken.length === 0
    ) {
      throw new Error('malformed credential');
    }
    return Buffer.from(credential.accessToken, 'utf8');
  });
}

function listCandidates(root) {
  const candidates = [];
  const trackedPaths = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  for (const trackedPath of trackedPaths) {
    candidates.push({
      absolutePath: resolve(root, trackedPath),
      displayPath: trackedPath,
    });
  }

  for (const artifactRoot of [
    resolve(root, 'apps/parent/dist'),
    resolve(root, 'apps/dashboard/dist'),
  ]) {
    addArtifactCandidates(artifactRoot, root, candidates);
  }

  return [
    ...new Map(
      candidates.map((candidate) => [candidate.absolutePath, candidate]),
    ).values(),
  ];
}

function addArtifactCandidates(path, root, candidates) {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
    candidates.push({
      absolutePath: path,
      displayPath: displayPath(root, path),
    });
    return;
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    candidates.push({
      absolutePath: path,
      displayPath: displayPath(root, path),
    });
    return;
  }

  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    candidates.push({
      absolutePath: path,
      displayPath: displayPath(root, path),
    });
    return;
  }
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      addArtifactCandidates(entryPath, root, candidates);
      continue;
    }
    candidates.push({
      absolutePath: entryPath,
      displayPath: displayPath(root, entryPath),
    });
  }
}

function displayPath(root, path) {
  return relative(root, path).split('\\').join('/') || '.';
}

function printSafeFailure(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

main();
