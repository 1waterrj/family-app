import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

const supportedDenylistCategories = [
  'child-name',
  'household-name',
  'prohibited-account',
  'obsolete-hostname',
  'local-user-path',
  'company-infrastructure',
];
const supportedDenylistCategorySet = new Set(supportedDenylistCategories);
const credentialPrefixes = [
  ['gh', 'p_'].join(''),
  ['github', '_pat_'].join(''),
  ['gh', 'o_'].join(''),
  ['gh', 'u_'].join(''),
  ['gh', 'r_'].join(''),
  ['gh', 's_'].join(''),
];
const knownBinarySignatures = [
  (contents) =>
    contents
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  (contents) => contents.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  (contents) =>
    contents.subarray(0, 6).equals(Buffer.from('GIF87a')) ||
    contents.subarray(0, 6).equals(Buffer.from('GIF89a')),
  (contents) =>
    contents.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    contents.subarray(8, 12).equals(Buffer.from('WEBP')),
  (contents) =>
    contents.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])),
  (contents) => contents.subarray(0, 4).equals(Buffer.from('wOFF')),
  (contents) => contents.subarray(0, 4).equals(Buffer.from('wOF2')),
  (contents) =>
    contents.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])),
  (contents) => contents.subarray(0, 4).equals(Buffer.from('OTTO')),
  (contents) =>
    contents
      .subarray(0, 8)
      .equals(Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f])),
];
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const binaryMetadataDecoders = [
  { decoder: new TextDecoder('utf-8'), byteOffsets: [0], unitSize: 1 },
  { decoder: new TextDecoder('utf-16le'), byteOffsets: [0, 1], unitSize: 2 },
  { decoder: new TextDecoder('utf-16be'), byteOffsets: [0, 1], unitSize: 2 },
];
const maximumBlobSize = 1024 * 1024 * 1024;

function main() {
  const findings = new Map();
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch {
    printSafeFailure('invalid-arguments');
    return;
  }

  let forbiddenText;
  try {
    forbiddenText = loadDenylist(options.denylistPath);
  } catch (error) {
    printSafeFailure(
      error instanceof PrivacyPolicyError
        ? error.category
        : 'privacy-policy-unreadable',
    );
    return;
  }

  try {
    for (const candidate of listRepositoryFiles(options.root)) {
      inspectCandidate(candidate, forbiddenText, findings, options.root);
    }
  } catch (error) {
    printSafeFailure(
      error instanceof RepositoryScanError
        ? error.category
        : 'tracked-files-unreadable',
    );
    return;
  }

  if (findings.size > 0) {
    printFindings(findings);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Public source privacy scan passed.\n');
}

function parseArguments(args) {
  if (args.length % 2 !== 0 || args.length > 4) {
    throw new Error('invalid argument count');
  }

  let root = resolve(import.meta.dirname, '..');
  let explicitDenylistPath;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      (option !== '--scan-root' && option !== '--denylist') ||
      seen.has(option) ||
      typeof value !== 'string' ||
      value.length === 0
    ) {
      throw new Error('invalid argument');
    }
    seen.add(option);
    if (option === '--scan-root') root = resolve(value);
    else explicitDenylistPath = resolve(value);
  }

  const rootStatus = lstatSync(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error('scan root must be a physical directory');
  }

  return {
    root,
    denylistPath:
      explicitDenylistPath ??
      resolve(root, '.local/public-source-privacy-denylist.json'),
  };
}

function loadDenylist(path) {
  let policyStatus;
  try {
    policyStatus = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new PrivacyPolicyError('privacy-policy-missing');
    }
    throw new PrivacyPolicyError('privacy-policy-unreadable');
  }

  if (policyStatus.isSymbolicLink()) {
    throw new PrivacyPolicyError('privacy-policy-insecure-permissions');
  }
  if (!policyStatus.isFile()) {
    throw new PrivacyPolicyError('privacy-policy-unreadable');
  }

  let policyDirectoryStatus;
  try {
    policyDirectoryStatus = lstatSync(dirname(path));
  } catch {
    throw new PrivacyPolicyError('privacy-policy-unreadable');
  }
  if (
    policyDirectoryStatus.isSymbolicLink() ||
    !policyDirectoryStatus.isDirectory()
  ) {
    throw new PrivacyPolicyError('privacy-policy-insecure-permissions');
  }
  if (
    process.platform !== 'win32' &&
    ((policyStatus.mode & 0o777) !== 0o600 ||
      (policyDirectoryStatus.mode & 0o077) !== 0)
  ) {
    throw new PrivacyPolicyError('privacy-policy-insecure-permissions');
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PrivacyPolicyError('privacy-policy-malformed');
    }
    throw new PrivacyPolicyError('privacy-policy-unreadable');
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new PrivacyPolicyError('privacy-policy-malformed');
  }

  const categories = Object.keys(parsed);
  if (
    categories.some((category) => !supportedDenylistCategorySet.has(category))
  ) {
    throw new PrivacyPolicyError('privacy-policy-unsupported-category');
  }
  if (
    supportedDenylistCategories.some(
      (category) => !Object.hasOwn(parsed, category),
    )
  ) {
    throw new PrivacyPolicyError('privacy-policy-missing-category');
  }

  const forbiddenText = [];
  const canonicalValues = new Set();
  for (const category of supportedDenylistCategories) {
    const values = parsed[category];
    if (!Array.isArray(values)) {
      throw new PrivacyPolicyError('privacy-policy-malformed');
    }
    if (values.length === 0) {
      throw new PrivacyPolicyError('privacy-policy-empty-category');
    }
    if (values.some((value) => typeof value !== 'string')) {
      throw new PrivacyPolicyError('privacy-policy-malformed');
    }
    for (const value of values) {
      const canonicalValue = canonicalizePrivateText(value);
      if (canonicalValue.trim().length === 0) {
        throw new PrivacyPolicyError('privacy-policy-empty-category');
      }
      if (canonicalValues.has(canonicalValue)) {
        throw new PrivacyPolicyError('privacy-policy-duplicate-value');
      }
      canonicalValues.add(canonicalValue);
      forbiddenText.push({ category, canonicalValue });
    }
  }
  return forbiddenText;
}

function listRepositoryFiles(root) {
  const candidates = new Map();
  let indexOutput;
  try {
    indexOutput = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: maximumBlobSize,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new RepositoryScanError('tracked-files-unreadable');
  }

  const trackedEntries = parseIndexEntries(indexOutput);
  for (const entry of trackedEntries) {
    candidates.set(entry.displayPath, entry);
  }

  for (const artifactRoot of [
    resolve(root, 'apps/parent/dist'),
    resolve(root, 'apps/dashboard/dist'),
  ]) {
    try {
      lstatSync(artifactRoot);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      const artifactPath = displayPath(root, artifactRoot);
      if (!candidates.has(artifactPath)) {
        candidates.set(artifactPath, {
          source: 'working-tree',
          absolutePath: artifactRoot,
          displayPath: artifactPath,
        });
      }
      continue;
    }
    listDirectoryFiles(artifactRoot, root, candidates);
  }

  return [...candidates.values()];
}

function parseIndexEntries(output) {
  const entries = [];
  const seenPaths = new Set();
  for (const record of splitNullTerminated(output)) {
    const separatorIndex = record.indexOf(0x09);
    if (separatorIndex < 0) {
      throw new RepositoryScanError('tracked-entry-invalid');
    }

    const header = record.subarray(0, separatorIndex).toString('ascii');
    const match = /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/.exec(header);
    if (!match) throw new RepositoryScanError('tracked-entry-invalid');

    const [, mode, objectId, stage] = match;
    if (stage !== '0') {
      throw new RepositoryScanError('tracked-entry-unmerged');
    }
    if (mode !== '100644' && mode !== '100755') {
      throw new RepositoryScanError('tracked-entry-unsupported-mode');
    }

    let trackedPath;
    try {
      trackedPath = textDecoder.decode(record.subarray(separatorIndex + 1));
    } catch {
      throw new RepositoryScanError('tracked-entry-invalid');
    }
    if (trackedPath.length === 0 || seenPaths.has(trackedPath)) {
      throw new RepositoryScanError('tracked-entry-invalid');
    }
    seenPaths.add(trackedPath);
    entries.push({
      source: 'index',
      objectId,
      displayPath: trackedPath,
    });
  }
  return entries;
}

function splitNullTerminated(output) {
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index > start) records.push(output.subarray(start, index));
    start = index + 1;
  }
  if (start !== output.length) {
    throw new RepositoryScanError('tracked-entry-invalid');
  }
  return records;
}

function listDirectoryFiles(path, root, candidates) {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    addWorkingTreeCandidate(candidates, root, path);
    return;
  }

  if (status.isSymbolicLink() || !status.isDirectory()) {
    addWorkingTreeCandidate(candidates, root, path);
    return;
  }

  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    addWorkingTreeCandidate(candidates, root, path);
    return;
  }
  for (const entry of entries) {
    listDirectoryFiles(resolve(path, entry.name), root, candidates);
  }
}

function addWorkingTreeCandidate(candidates, root, path) {
  const candidatePath = displayPath(root, path);
  if (candidates.has(candidatePath)) return;
  candidates.set(candidatePath, {
    source: 'working-tree',
    absolutePath: path,
    displayPath: candidatePath,
  });
}

function inspectCandidate(candidate, forbiddenText, findings, root) {
  const { displayPath } = candidate;
  const sensitivePathCategories = matchingPrivateCategories(
    displayPath,
    forbiddenText,
  );
  const safePath =
    sensitivePathCategories.length > 0
      ? '<sensitive-path>'
      : safeDisplayPath(displayPath);
  for (const category of sensitivePathCategories) {
    addFinding(findings, category, safePath);
  }

  let contents;
  if (candidate.source === 'index') {
    try {
      contents = execFileSync('git', ['cat-file', 'blob', candidate.objectId], {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: maximumBlobSize,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      throw new RepositoryScanError('indexed-blob-unreadable');
    }
  } else {
    try {
      const status = lstatSync(candidate.absolutePath);
      if (status.isSymbolicLink() || !status.isFile()) {
        addFinding(findings, 'unreadable-file', safePath);
        return;
      }
      contents = readFileSync(candidate.absolutePath);
    } catch {
      addFinding(findings, 'unreadable-file', safePath);
      return;
    }
  }

  const isRecognizedBinary = knownBinarySignatures.some((matches) =>
    matches(contents),
  );
  if (isRecognizedBinary) {
    inspectRecognizedBinary(contents, forbiddenText, findings, safePath);
    return;
  }
  if (contents.includes(0)) {
    addFinding(findings, 'unrecognized-binary', safePath);
    return;
  }

  let text;
  try {
    text = textDecoder.decode(contents);
  } catch {
    addFinding(findings, 'unrecognized-binary', safePath);
    return;
  }

  for (const category of matchingPrivateCategories(text, forbiddenText)) {
    addFinding(findings, category, safePath);
  }
  if (containsCredentialPrefix(contents)) {
    addFinding(findings, 'credential-shape', safePath);
  }
}

function inspectRecognizedBinary(contents, forbiddenText, findings, safePath) {
  for (const metadataText of decodeBinaryMetadataViews(contents)) {
    for (const category of matchingPrivateCategories(
      metadataText,
      forbiddenText,
    )) {
      addFinding(findings, category, safePath);
    }
  }
  if (containsCredentialPrefix(contents)) {
    addFinding(findings, 'credential-shape', safePath);
  }
}

function decodeBinaryMetadataViews(contents) {
  return binaryMetadataDecoders.flatMap(({ decoder, byteOffsets, unitSize }) =>
    byteOffsets.map((byteOffset) => {
      // Both UTF-16 byte parities are candidates. Drop only an incomplete
      // trailing code unit; retaining every interior byte avoids synthesized
      // matches from indiscriminately stripping binary control bytes.
      const trailingByteCount = (contents.length - byteOffset) % unitSize;
      return decoder.decode(
        contents.subarray(byteOffset, contents.length - trailingByteCount),
      );
    }),
  );
}

function matchingPrivateCategories(candidateText, forbiddenText) {
  const canonicalCandidate = canonicalizePrivateText(candidateText);
  const categories = new Set();
  for (const { category, canonicalValue } of forbiddenText) {
    if (canonicalCandidate.includes(canonicalValue)) categories.add(category);
  }
  return [...categories];
}

function canonicalizePrivateText(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\s+/gu, ' ');
}

function containsCredentialPrefix(contents) {
  return credentialPrefixes.some((prefix) =>
    contents.includes(Buffer.from(prefix, 'utf8')),
  );
}

function addFinding(findings, category, path) {
  if (!findings.has(category)) findings.set(category, new Set());
  findings.get(category).add(path);
}

function displayPath(root, path) {
  return relative(root, path).split('\\').join('/') || '.';
}

function safeDisplayPath(path) {
  return /[\p{Cc}\p{Cf}\p{Cs}]/u.test(path) || path.startsWith('/')
    ? '<unsafe-path>'
    : path;
}

function printFindings(findings) {
  const lines = [...findings.entries()]
    .flatMap(([category, paths]) =>
      [...paths].map((path) => `[${category}] ${path}`),
    )
    .sort();
  process.stderr.write(`${lines.join('\n')}\n`);
}

function printSafeFailure(category) {
  process.stderr.write(`[${category}]\n`);
  process.exitCode = 1;
}

class PrivacyPolicyError extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

class RepositoryScanError extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

main();
