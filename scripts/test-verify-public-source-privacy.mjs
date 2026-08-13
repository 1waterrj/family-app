import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import process from 'node:process';

process.umask(0o077);

const repositoryRoot = resolve(import.meta.dirname, '..');
const scannerPath = resolve(
  repositoryRoot,
  'scripts/verify-public-source-privacy.mjs',
);
const fixtureRoot = mkdtempSync(
  resolve(tmpdir(), 'family-public-source-privacy-'),
);
const localPolicyDirectory = resolve(fixtureRoot, '.local');
const policyPath = resolve(
  localPolicyDirectory,
  'public-source-privacy-denylist.json',
);
const syntheticPolicy = {
  'child-name': ['Synthetic Child Alpha', 'Synthetic Child Beta'],
  'household-name': ['Synthetic Household'],
  'prohibited-account': ['fictional-owner-account'],
  'obsolete-hostname': ['obsolete.example.invalid'],
  'local-user-path': ['/Users/fictional.user'],
  'company-infrastructure': ['Fictional Company Registry'],
};
const policyCases = Object.entries(syntheticPolicy).flatMap(
  ([category, values]) => values.map((value) => [category, value]),
);
const credentialCase = [
  'credential-shape',
  ['gh', 'p_'].join('') + 'A1b2'.repeat(12),
];
const candidatePath = resolve(fixtureRoot, 'candidate.txt');
const generatedHermesPath = resolve(
  fixtureRoot,
  'apps/parent/dist/generated.hbc',
);
const hermesMagic = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);
const cleanPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const safeCandidateText =
  'Fictional product copy: Cobalt Orchard coordinates pretend schedules.\n';
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

if ((statSync(fixtureRoot).mode & 0o077) !== 0) {
  throw new Error('The scanner fixture directory must be owner-only.');
}

runGit(['init']);
writeTrackedFile(
  candidatePath,
  'Fictional product copy: Cobalt Orchard coordinates pretend schedules.\n',
);
assertPolicyFailure(
  runScanner(['--scan-root', fixtureRoot]),
  'privacy-policy-missing',
  'missing default policy',
);
scenarioCount += 1;

writePolicy(syntheticPolicy);

const reviewFailures = [];
const reviewTemporaryPaths = [];

runReviewScenario('case-only private-content matching bypass', () => {
  writeTrackedFile(candidatePath, 'sYnThEtIc cHiLd aLpHa\n');
  assertFinding(
    runScannerWithPolicy('root-first'),
    'child-name',
    'a case-only variant of a policy value',
  );
});

runReviewScenario('NFKC compatibility matching bypass', () => {
  writeTrackedFile(
    candidatePath,
    'Ｆｉｃｔｉｏｎａｌ Ｃｏｍｐａｎｙ Ｒｅｇｉｓｔｒｙ\n',
  );
  assertFinding(
    runScannerWithPolicy('root-first'),
    'company-infrastructure',
    'an NFKC compatibility variant of a policy value',
  );
});

runReviewScenario('default-ignorable split matching bypass', () => {
  writeTrackedFile(candidatePath, 'Syn\u200bthetic Child Alpha\n');
  assertFinding(
    runScannerWithPolicy('root-first'),
    'child-name',
    'a policy value split by a default-ignorable code point',
  );
});

runReviewScenario('Unicode whitespace matching bypass', () => {
  writeTrackedFile(candidatePath, 'Synthetic\u00a0\tHousehold\n');
  assertFinding(
    runScannerWithPolicy('root-first'),
    'household-name',
    'a policy value separated by Unicode whitespace',
  );
});

runReviewScenario('tracked filename-only matching bypass', () => {
  const sensitiveRelativePath = 'notes/Synthetic Child Alpha-notes.txt';
  const sensitivePath = resolve(fixtureRoot, sensitiveRelativePath);
  reviewTemporaryPaths.push(resolve(fixtureRoot, 'notes'));
  mkdirSync(resolve(fixtureRoot, 'notes'), { mode: 0o700, recursive: true });
  writeFileSync(sensitivePath, safeCandidateText, { mode: 0o600 });
  runGit(['add', '--', sensitiveRelativePath]);
  const result = runScannerWithPolicy('root-first');
  if (
    result.status === 0 ||
    result.stdout !== '' ||
    result.stderr !== '[child-name] <sensitive-path>\n'
  ) {
    throw new Error(
      'Scanner did not reject a filename-only match with a redacted path.',
    );
  }
  assertNoPolicyValues(result);
});

runReviewScenario('working-tree edit bypasses staged private content', () => {
  writeTrackedFile(candidatePath, 'Synthetic Child Alpha\n');
  writeFileSync(candidatePath, safeCandidateText, { mode: 0o600 });
  assertFinding(
    runScannerWithPolicy('root-first'),
    'child-name',
    'a staged policy value hidden by a safe unstaged edit',
  );
});

runReviewScenario('recognized binary metadata matching bypass', () => {
  writeTrackedFile(
    candidatePath,
    Buffer.concat([cleanPng, Buffer.from('Synthetic Child Alpha')]),
  );
  assertFinding(
    runScannerWithPolicy('root-first'),
    'child-name',
    'a full-signature binary with appended private metadata',
  );
});

runReviewScenario('recognized binary UTF-16LE metadata matching bypass', () => {
  writeTrackedFile(
    candidatePath,
    Buffer.concat([cleanPng, Buffer.from('Synthetic Child Alpha', 'utf16le')]),
  );
  assertFinding(
    runScannerWithPolicy('root-first'),
    'child-name',
    'a full-signature binary with UTF-16LE private metadata',
  );
});

runReviewScenario('recognized binary UTF-16BE metadata matching bypass', () => {
  writeTrackedFile(
    candidatePath,
    Buffer.concat([
      cleanPng,
      Buffer.from([0x01]),
      encodeUtf16Be('Synthetic Child Alpha'),
    ]),
  );
  assertFinding(
    runScannerWithPolicy('root-first'),
    'child-name',
    'a full-signature binary with odd-aligned UTF-16BE private metadata',
  );
});

runReviewScenario('recognized binary credential matching bypass', () => {
  writeTrackedFile(
    candidatePath,
    Buffer.concat([cleanPng, Buffer.from(credentialCase[1])]),
  );
  assertFinding(
    runScannerWithPolicy('root-first'),
    'credential-shape',
    'a full-signature binary with appended credential metadata',
  );
});

runReviewScenario('canonical-empty policy value acceptance', () => {
  writePolicy({ ...syntheticPolicy, 'child-name': ['\u200b'] });
  assertPolicyFailure(
    runScannerWithPolicy('root-first'),
    'privacy-policy-empty-category',
    'a canonical-empty policy value',
  );
});

runReviewScenario('canonical-duplicate policy value acceptance', () => {
  writePolicy({
    ...syntheticPolicy,
    'child-name': [
      'Synthetic Child Alpha',
      'Ｓｙｎｔｈｅｔｉｃ　Ｃｈｉｌｄ　Ａｌｐｈａ',
    ],
  });
  assertPolicyFailure(
    runScannerWithPolicy('root-first'),
    'privacy-policy-duplicate-value',
    'canonically duplicate policy values',
  );
});

runReviewScenario('unmerged index entry acceptance', () => {
  runGit(['update-index', '--force-remove', 'candidate.txt']);
  const blobOid = runGit(['hash-object', '-w', '--stdin'], safeCandidateText);
  runGit(
    ['update-index', '--index-info'],
    `100644 ${blobOid.trim()} 1\tconflict.txt\n`,
  );
  assertPolicyFailure(
    runScannerWithPolicy('root-first'),
    'tracked-entry-unmerged',
    'an unmerged index entry',
  );
});

runReviewScenario('unsupported tracked mode acceptance', () => {
  runGit(['update-index', '--force-remove', 'candidate.txt']);
  const blobOid = runGit(['hash-object', '-w', '--stdin'], safeCandidateText);
  runGit([
    'update-index',
    '--add',
    '--cacheinfo',
    `120000,${blobOid.trim()},synthetic-link`,
  ]);
  assertPolicyFailure(
    runScannerWithPolicy('root-first'),
    'tracked-entry-unsupported-mode',
    'an unsupported tracked mode',
  );
});

runReviewScenario('unreadable indexed blob acceptance', () => {
  runGit(['update-index', '--force-remove', 'candidate.txt']);
  runGit([
    'update-index',
    '--add',
    '--info-only',
    '--cacheinfo',
    `100644,${'1'.repeat(40)},missing-blob.txt`,
  ]);
  const result = runScannerWithPolicy('root-first');
  try {
    assertPolicyFailure(
      result,
      'indexed-blob-unreadable',
      'an unreadable indexed blob',
    );
  } catch (error) {
    const category =
      /^\[([^\]]+)]\n$/.exec(result.stderr)?.[1] ?? 'non-safe-output';
    throw new Error(
      `${error.message} (status ${result.status}, category ${category})`,
      { cause: error },
    );
  }
});

if (reviewFailures.length > 0) {
  throw new Error(
    `Scanner review regressions:\n${reviewFailures.map((failure) => `- ${failure}`).join('\n')}`,
  );
}

for (const [index, [category, syntheticValue]] of [
  ...policyCases,
  credentialCase,
].entries()) {
  writeTrackedFile(candidatePath, `${syntheticValue}\n`);
  const result = runScannerWithPolicy('root-first');
  if (result.status === 0) {
    throw new Error(`Scanner accepted controlled scenario ${index + 1}.`);
  }
  if (
    !result.stderr.includes(`[${category}]`) ||
    !result.stderr.includes('candidate.txt')
  ) {
    throw new Error(
      `Scanner omitted the finding for controlled scenario ${index + 1}.`,
    );
  }
  assertNoPolicyValues(result);
  scenarioCount += 1;
}

writeTrackedFile(
  candidatePath,
  'Fictional product copy: Cobalt Orchard coordinates pretend schedules.\n',
);
for (const order of ['root-first', 'policy-first']) {
  const safeResult = runScannerWithPolicy(order);
  if (safeResult.status !== 0) {
    throw new Error(`Scanner rejected fictional product content (${order}).`);
  }
  if (safeResult.stdout !== 'Public source privacy scan passed.\n') {
    throw new Error(`Scanner did not report a clean scan (${order}).`);
  }
  scenarioCount += 1;
}

writeTrackedFile(candidatePath, cleanPng);
const pngResult = runScannerWithPolicy('root-first');
if (pngResult.status !== 0) {
  throw new Error('Scanner rejected an authentic clean tracked PNG.');
}
scenarioCount += 1;

writeTrackedFile(candidatePath, hermesMagic);
const hermesResult = runScannerWithPolicy('root-first');
if (hermesResult.status !== 0) {
  throw new Error('Scanner rejected a tracked Hermes bytecode signature.');
}
scenarioCount += 1;

writeTrackedFile(
  candidatePath,
  Buffer.concat([
    hermesMagic.subarray(0, 4),
    Buffer.from('Synthetic Child Alpha'),
  ]),
);
assertFinding(
  runScannerWithPolicy('root-first'),
  'unrecognized-binary',
  'a partial Hermes prefix containing a policy value',
);
scenarioCount += 1;

mkdirSync(resolve(fixtureRoot, 'apps/parent/dist'), {
  mode: 0o700,
  recursive: true,
});
writeFileSync(generatedHermesPath, Buffer.from('Synthetic Child Alpha'), {
  mode: 0o600,
});
assertFinding(
  runScannerWithPolicy('root-first'),
  'child-name',
  'a generated artifact containing a policy value',
  'apps/parent/dist/generated.hbc',
);
writeFileSync(generatedHermesPath, hermesMagic, { mode: 0o600 });
writeTrackedFile(
  candidatePath,
  'Fictional product copy: Cobalt Orchard coordinates pretend schedules.\n',
);
const generatedHermesResult = runScannerWithPolicy('root-first');
if (generatedHermesResult.status !== 0) {
  throw new Error('Scanner rejected a generated Hermes bytecode signature.');
}
scenarioCount += 2;

writeTrackedFile(candidatePath, Buffer.from([0x61, 0x00, 0x62]));
assertFinding(
  runScannerWithPolicy('root-first'),
  'unrecognized-binary',
  'NUL-containing unknown file',
);
scenarioCount += 1;

writeFileSync(generatedHermesPath, 'Unreadable generated text.\n', {
  mode: 0o600,
});
chmodSync(generatedHermesPath, 0o000);
let unreadableEnforced = false;
try {
  readFileSync(generatedHermesPath);
} catch {
  unreadableEnforced = true;
}
const unreadableResult = runScannerWithPolicy('root-first');
if (unreadableEnforced) {
  assertFinding(
    unreadableResult,
    'unreadable-file',
    'unreadable generated file',
    'apps/parent/dist/generated.hbc',
  );
}
chmodSync(generatedHermesPath, 0o600);
writeFileSync(generatedHermesPath, hermesMagic, { mode: 0o600 });
scenarioCount += 1;

assertPolicyFailure(
  runScanner([
    '--scan-root',
    fixtureRoot,
    '--denylist',
    resolve(fixtureRoot, 'missing-policy.json'),
  ]),
  'privacy-policy-missing',
  'missing explicit policy',
);
scenarioCount += 1;

const malformedPolicy = 'Synthetic malformed policy content';
writeFileSync(policyPath, malformedPolicy, { mode: 0o600 });
assertPolicyFailure(
  runScannerWithPolicy('root-first'),
  'privacy-policy-malformed',
  'malformed policy',
  [malformedPolicy],
);
scenarioCount += 1;

writePolicy(syntheticPolicy);
chmodSync(policyPath, 0o644);
assertPolicyFailure(
  runScannerWithPolicy('root-first'),
  'privacy-policy-insecure-permissions',
  'insecure policy file',
);
chmodSync(policyPath, 0o600);
scenarioCount += 1;

chmodSync(localPolicyDirectory, 0o755);
assertPolicyFailure(
  runScannerWithPolicy('root-first'),
  'privacy-policy-insecure-permissions',
  'insecure policy directory',
);
chmodSync(localPolicyDirectory, 0o700);
scenarioCount += 1;

const unreadablePolicyPath = resolve(fixtureRoot, 'unreadable-policy');
mkdirSync(unreadablePolicyPath, { mode: 0o700 });
assertPolicyFailure(
  runScanner(['--scan-root', fixtureRoot, '--denylist', unreadablePolicyPath]),
  'privacy-policy-unreadable',
  'unreadable policy path',
);
scenarioCount += 1;

const unsupportedPolicy = {
  ...syntheticPolicy,
  'synthetic-unsupported': ['Synthetic Unsupported Value'],
};
writePolicy(unsupportedPolicy);
assertPolicyFailure(
  runScannerWithPolicy('root-first'),
  'privacy-policy-unsupported-category',
  'unsupported policy category',
  ['Synthetic Unsupported Value'],
);
scenarioCount += 1;

writePolicy({ ...syntheticPolicy, 'child-name': [] });
assertPolicyFailure(
  runScannerWithPolicy('root-first'),
  'privacy-policy-empty-category',
  'empty policy category',
);
scenarioCount += 1;

const missingCategoryPolicy = { ...syntheticPolicy };
delete missingCategoryPolicy['company-infrastructure'];
writePolicy(missingCategoryPolicy);
assertPolicyFailure(
  runScannerWithPolicy('root-first'),
  'privacy-policy-missing-category',
  'missing policy category',
);
scenarioCount += 1;

process.stdout.write(
  `Public source privacy scanner self-test passed (${scenarioCount} controlled scenarios).\n`,
);

function writeTrackedFile(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  runGit(['add', '--', relative(fixtureRoot, path)]);
}

function writePolicy(policy) {
  mkdirSync(localPolicyDirectory, { mode: 0o700, recursive: true });
  chmodSync(localPolicyDirectory, 0o700);
  writeFileSync(policyPath, `${JSON.stringify(policy)}\n`, { mode: 0o600 });
  chmodSync(policyPath, 0o600);
}

function encodeUtf16Be(value) {
  const encoded = Buffer.alloc(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    encoded.writeUInt16BE(value.charCodeAt(index), index * 2);
  }
  return encoded;
}

function assertFinding(
  result,
  category,
  scenario,
  expectedPath = 'candidate.txt',
) {
  if (
    result.status === 0 ||
    !result.stderr.includes(`[${category}]`) ||
    !result.stderr.includes(expectedPath)
  ) {
    throw new Error(`Scanner did not reject ${scenario}.`);
  }
  assertNoPolicyValues(result);
}

function assertPolicyFailure(result, category, scenario, extraSecrets = []) {
  if (result.status === 0 || result.stderr !== `[${category}]\n`) {
    throw new Error(`Scanner did not fail safely for ${scenario}.`);
  }
  if (result.stdout !== '') {
    throw new Error(`Scanner wrote stdout for ${scenario}.`);
  }
  assertNoPolicyValues(result, extraSecrets);
}

function assertNoPolicyValues(result, extraSecrets = []) {
  const output = `${result.stdout}${result.stderr}`;
  for (const value of [
    ...Object.values(syntheticPolicy).flat(),
    ...extraSecrets,
  ]) {
    if (output.includes(value)) {
      throw new Error('Scanner leaked a synthetic policy value.');
    }
  }
}

function runReviewScenario(name, run) {
  try {
    run();
  } catch (error) {
    reviewFailures.push(`${name}: ${error.message}`);
  } finally {
    writePolicy(syntheticPolicy);
    runGit(['read-tree', '--empty']);
    for (const path of reviewTemporaryPaths.splice(0)) {
      rmSync(path, { force: true, recursive: true });
    }
    writeTrackedFile(candidatePath, safeCandidateText);
  }
  scenarioCount += 1;
}

function runGit(args, input) {
  const result = spawnSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    input,
  });
  if (result.status !== 0) {
    throw new Error(`Fixture Git setup failed: ${args[0]}.`);
  }
  return result.stdout;
}

function runScannerWithPolicy(order) {
  const rootArguments = ['--scan-root', fixtureRoot];
  const policyArguments = ['--denylist', policyPath];
  return runScanner(
    order === 'policy-first'
      ? [...policyArguments, ...rootArguments]
      : [...rootArguments, ...policyArguments],
  );
}

function runScanner(args) {
  return spawnSync(process.execPath, [scannerPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}
