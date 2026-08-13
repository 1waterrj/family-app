# Public Repository Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status:** The ignored SDD execution ledger is authoritative. The checkboxes in this tracked plan are intentionally immutable historical instructions, not live completion markers.

**Goal:** Publish `1waterrj/family-app` as a public GitHub repository containing one verified, anonymized root commit while preserving the original history only in an ignored local recovery bundle.

**Architecture:** Add an independent tracked-source privacy scanner beside the existing credential scanners, then replace family-specific source and documentation fixtures with fictional data in an isolated worktree. After all project gates pass, create a verified local Git bundle, manufacture one public root commit from the sanitized tree, move local `main` with compare-and-swap safety checks, verify it again, and push only that branch to a newly created public repository.

**Tech Stack:** Node.js 24, pnpm 11, ECMAScript modules, Bash, Git, GitHub CLI, TypeScript, Vitest, Jest, Playwright, Expo, Vite

## Global Constraints

- The public destination is exactly `1waterrj/family-app`; never use the prohibited alternate GitHub account.
- Public fixtures use `Example Family`, `Avery`, and `Riley`; code-level child identifiers use `primary` and `secondary` terminology.
- Only obviously fictional development fixtures may ship. Real or family-identifying fixtures are prohibited in source, tests, generated artifacts, and documentation.
- The intended hostname is `family.jordanwaters.net`; obsolete hostname variants are prohibited.
- Use public package registries and personal/local infrastructure only. Do not use
  company accounts, credentials, registries, cloud resources, or network
  services for this project.
- Real household data remains runtime-only in ignored local files and the local database.
- The privacy verifier scans tracked files, reports only category and path, loads private match values only from the ignored owner-readable policy at `.local/public-source-privacy-denylist.json`, rejects unreadable text, and skips only recognized binary formats.
- Keep `.local` owner-only (`0700`) and the denylist file owner-readable only (`0600`). Missing, unreadable, malformed, insecure, incomplete, empty, or unsupported policy data blocks every privacy gate.
- Existing credential and GitHub-token scanners remain separate release gates.
- Do not add a software license during this operation.
- Do not expose the current development authenticator through Cloudflare or any other public ingress.
- Create and verify an ignored local Git bundle before changing `main`; do not create a backup branch or tag.
- Publish no pre-sanitization commit, branch, tag, or other ref.
- Run all application verification under Node.js 24.

---

## File Structure

- `scripts/verify-public-source-privacy.mjs`: scans stage-0 regular-file blobs from the Git index, tracked pathnames, and approved generated bundle locations for prohibited privacy categories without printing matched content or a sensitive pathname.
- `scripts/test-verify-public-source-privacy.mjs`: creates owner-only isolated Git fixtures and proves every category, binary handling, unreadable-file handling, output redaction, and clean content behavior.
- `.local/public-source-privacy-denylist.json`: ignored owner-only JSON policy containing exactly the six private keys `child-name`, `household-name`, `prohibited-account`, `obsolete-hostname`, `local-user-path`, and `company-infrastructure`, each mapped to a nonempty array of nonempty strings; never commit or publish it, and never add `credential-shape`.
- `package.json`: exposes `verify:public-source-privacy` as a root gate.
- `scripts/verify-production-bundles.sh`: runs the privacy scanner after production exports alongside the two existing independent credential scanners.
- `README.md`: presents the monorepo, packages, local-first posture, runbook link, and public-ingress warning.
- `apps/api/src/dev/seed.ts`: contains only fictional household development data and neutral local identifiers.
- `packages/design-tokens/src/index.ts`: exports neutral `primary` and `secondary` child theme keys.
- `apps/**`, `packages/**`, and `e2e/**`: use fictional display fixtures and neutral identifiers while preserving behavior.
- `docs/**`: uses fictional household examples, the correct `.net` hostname, portable path placeholders, and general public-infrastructure guidance.

### Task 1: Add the tracked-source privacy gate

**Files:**
- Create: `scripts/verify-public-source-privacy.mjs`
- Create: `scripts/test-verify-public-source-privacy.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-production-bundles.sh`

**Interfaces:**
- Consumes: `git ls-files --stage -z`, indexed blobs, optional CLI forms `--scan-root PATH` and `--denylist PATH` in either order, the default ignored policy `.local/public-source-privacy-denylist.json`, and generated bundle directories `apps/parent/dist` and `apps/dashboard/dist`.
- Produces: exit status `0` with `Public source privacy scan passed.\n`; tracked-content failures as `[category] relative/path`; safe policy and CLI failures as category-only `[category]` lines with no policy value and no path when a path is not appropriate; root command `pnpm verify:public-source-privacy`.

- [ ] **Step 1: Write the adversarial self-test**

Create `scripts/test-verify-public-source-privacy.mjs` with a `umask(0o077)` temporary Git repository and an owner-only synthetic denylist. Initialize the fixture with `git init`, write and `git add` one controlled `candidate.txt` at a time, and invoke the scanner with explicit `--scan-root` and `--denylist` arguments in both orders.

```js
const privatePolicyCategories = [
  'child-name',
  'household-name',
  'prohibited-account',
  'obsolete-hostname',
  'local-user-path',
  'company-infrastructure',
];
const publicCredentialCategory = 'credential-shape';
```

Use only obviously fictional synthetic strings in the six-key test policy. Test `credential-shape` separately from tracked public credential prefixes; it is not a policy key. For every case, require a nonzero status, require the category and `candidate.txt` in `stderr`, and assert that neither `stdout` nor `stderr` contains any policy value. Then assert fictional product content and recognized binary signatures pass; unknown or unreadable tracked files fail closed; and missing, unreadable, malformed, insecure, incomplete, empty, or unsupported policies fail with category-only output. Register exit, `SIGHUP`, `SIGINT`, and `SIGTERM` cleanup handlers.

- [ ] **Step 2: Run the self-test to verify the scanner is absent**

Run:

```bash
node scripts/test-verify-public-source-privacy.mjs
```

Expected: nonzero exit because `scripts/verify-public-source-privacy.mjs` does not exist.

- [ ] **Step 3: Implement the privacy scanner**

Create `scripts/verify-public-source-privacy.mjs` with a public category allowlist and no private values. The default policy path is `.local/public-source-privacy-denylist.json` under the scan root; `--denylist PATH` overrides it for synthetic tests and owner-only audit clones.

```js
const findings = new Map();
const privatePolicy = loadOwnerOnlyIgnoredPolicy(denylistPath);
const credentialPrefixes = publicCredentialShapes;
```

Use `execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root })` for both repository and test-fixture scans. Require exactly one stage-0 entry with regular-file mode `100644` or `100755`, then scan its indexed blob; fail closed for unmerged entries, unsupported modes, or unreadable blobs. Accept exact optional `--scan-root PATH` and `--denylist PATH` pairs in either order, require a physical scan root, and refuse symbolic links. Require an exact `0600` physical policy file under an owner-only physical directory. Parse a JSON object containing exactly the six private keys listed above, no `credential-shape` or other unsupported key, and a nonempty array of nonempty strings per key. Canonicalize policy values, content, and tracked pathnames with NFKC, `toLocaleLowerCase('en-US')`, default-ignorable removal, and Unicode-whitespace collapse; reject canonical-empty and canonical-duplicate policy values. Inspect printable/decodable metadata in recognized binaries while retaining exact raw credential-prefix checks. Fail with category-only output for every policy or index error, substitute a safe placeholder when a pathname matches, and never print a policy value. Preserve generated-bundle traversal, deduplication, sorting, and clean recognized-binary behavior.

- [ ] **Step 4: Run the scanner self-test**

Run:

```bash
node scripts/test-verify-public-source-privacy.mjs
```

Expected: exit `0` and a summary that names the number of controlled scenarios without containing any controlled private value.

- [ ] **Step 5: Wire the scanner into root and production gates**

Add this root script to `package.json`:

```json
"verify:public-source-privacy": "node scripts/verify-public-source-privacy.mjs"
```

In `scripts/verify-production-bundles.sh`, run the new scanner immediately before the two existing scanners:

```bash
node scripts/verify-public-source-privacy.mjs
node scripts/verify-no-credential-leaks.mjs
node scripts/verify-no-github-credentials.mjs
```

Update the final success message to include public-source privacy.

Before running either root gate, create the ignored
`.local/public-source-privacy-denylist.json` outside tracked source. Set `.local`
to mode `0700` and the policy to `0600`. The JSON object must contain exactly
`child-name`, `household-name`, `prohibited-account`, `obsolete-hostname`,
`local-user-path`, and `company-infrastructure`, with no extra keys and a
nonempty array of nonempty strings for each key. `credential-shape` must not be
present because public credential patterns remain tracked and independently
scanned. Use the owner's private values only in that ignored file; public
examples may use obviously fictional synthetic strings. Copy this same six-key
policy unchanged into rewritten `main` and owner-only audit clones.

- [ ] **Step 6: Prove the current tracked tree is rejected**

Run:

```bash
pnpm verify:public-source-privacy
```

Expected: nonzero exit with category/path findings for current family-specific source and documentation, and no matched private content in output.

- [ ] **Step 7: Commit the independent privacy gate**

```bash
git add package.json scripts/verify-public-source-privacy.mjs scripts/test-verify-public-source-privacy.mjs scripts/verify-production-bundles.sh
git commit -m "test: guard public source privacy"
```

### Task 2: Anonymize executable source and test fixtures

**Files:**
- Modify: `apps/api/src/dev/seed.ts`
- Modify: tracked files under `apps/api/src/**/*.test.ts`
- Modify: tracked files under `apps/api/test/**`
- Modify: tracked files under `apps/dashboard/src/**`
- Modify: tracked files under `apps/parent/**`
- Modify: tracked files under `packages/**`
- Modify: tracked files under `e2e/**`

**Interfaces:**
- Consumes: existing APIs, schemas, route contracts, test helper contracts, and design token shape.
- Produces: identical behavior with `Example Family`, `Avery`, and `Riley`; design token keys `child.primary` and `child.secondary`; neutral local identifiers such as `primaryChildId` and `secondaryChildId`.

- [ ] **Step 1: Capture executable-source findings**

Run:

```bash
pnpm verify:public-source-privacy 2> .local/public-source-findings.txt
# Independently audit apps, packages, and e2e with the locally held private pattern set.
```

Expected: the scanner output and independent audit identify the executable and test files that require fixture-only edits.

- [ ] **Step 2: Replace the development seed**

In `apps/api/src/dev/seed.ts`, use this fixture vocabulary everywhere:

```ts
const householdName = 'Example Family';
const primaryChildName = 'Avery';
const secondaryChildName = 'Riley';
```

Rename real-name-derived variables and IDs to `primary*` and `secondary*`. Preserve database relations, balances, chore values, approval states, timestamps, and seeded record counts.

- [ ] **Step 3: Neutralize the design-token API**

In `packages/design-tokens/src/index.ts`, replace real-name token keys with:

```ts
child: {
  primary: existingFirstChildColorValue,
  secondary: existingSecondChildColorValue,
}
```

Update every consumer and assertion under `apps/**`, `packages/**`, and `e2e/**` to use `child.primary` and `child.secondary`. Do not change the color values.

- [ ] **Step 4: Replace application and test fixtures**

Apply the approved private-to-fictional display-data map across tracked executable and test files:

```text
first child fixture -> Avery
second child fixture -> Riley
household fixture -> Example Family
```

Rename identifiers rather than only changing string values:

```text
first-child-derived identifiers -> primaryChild*
second-child-derived identifiers -> secondaryChild*
```

Preserve snapshots and assertions by updating expected display text only. Do not alter role permissions, chore claim timers, adjustable approval awards, balance ledger behavior, calendar behavior, feedback privacy, networking setup, or Home Assistant behavior.

- [ ] **Step 5: Run focused application checks**

Run:

```bash
pnpm --filter @family/design-tokens test
pnpm --filter @family/api test
pnpm --filter @family/dashboard test
pnpm --filter @family/parent test -- --runInBand
pnpm typecheck
```

Expected: every command exits `0` with fixture-only expectation changes.

- [ ] **Step 6: Verify executable-source privacy and commit**

Stage only the intended executable and fixture changes, then inspect the exact prospective index before scanning it:

```bash
git add -- apps packages e2e
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git diff --cached -- apps packages e2e
pnpm verify:public-source-privacy
node --input-type=module - apps packages e2e <<'NODE'
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

const policyPath = resolve('.local/public-source-privacy-denylist.json');
const supportedCategories = [
  'child-name',
  'household-name',
  'prohibited-account',
  'obsolete-hostname',
  'local-user-path',
  'company-infrastructure',
];
const supportedCategorySet = new Set(supportedCategories);
const failPolicy = (category) => {
  process.stderr.write(`[${category}]\n`);
  process.exit(1);
};
let policyStatus;
try {
  policyStatus = lstatSync(policyPath);
} catch (error) {
  failPolicy(
    error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
      ? 'privacy-policy-missing'
      : 'privacy-policy-unreadable',
  );
}
if (policyStatus.isSymbolicLink()) {
  failPolicy('privacy-policy-insecure-permissions');
}
if (!policyStatus.isFile()) failPolicy('privacy-policy-unreadable');
let policyDirectoryStatus;
try {
  policyDirectoryStatus = lstatSync(dirname(policyPath));
} catch {
  failPolicy('privacy-policy-unreadable');
}
if (
  policyDirectoryStatus.isSymbolicLink() ||
  !policyDirectoryStatus.isDirectory() ||
  (policyStatus.mode & 0o777) !== 0o600 ||
  (policyDirectoryStatus.mode & 0o077) !== 0
) {
  failPolicy('privacy-policy-insecure-permissions');
}
let policyText;
try {
  policyText = readFileSync(policyPath, 'utf8');
} catch {
  failPolicy('privacy-policy-unreadable');
}
let policy;
try {
  policy = JSON.parse(policyText);
} catch {
  failPolicy('privacy-policy-malformed');
}
if (policy === null || Array.isArray(policy) || typeof policy !== 'object') {
  failPolicy('privacy-policy-malformed');
}
if (Object.keys(policy).some((key) => !supportedCategorySet.has(key))) {
  failPolicy('privacy-policy-unsupported-category');
}
if (supportedCategories.some((key) => !Object.hasOwn(policy, key))) {
  failPolicy('privacy-policy-missing-category');
}
for (const category of supportedCategories) {
  const values = policy[category];
  if (!Array.isArray(values)) failPolicy('privacy-policy-malformed');
  if (
    values.length === 0 ||
    values.some(
      (value) => typeof value === 'string' && value.trim().length === 0,
    )
  ) {
    failPolicy('privacy-policy-empty-category');
  }
  if (values.some((value) => typeof value !== 'string')) {
    failPolicy('privacy-policy-malformed');
  }
}

const roots = process.argv.slice(2);
let indexOutput;
try {
  indexOutput = execFileSync(
    'git',
    ['ls-files', '--stage', '-z', '--', ...roots],
    { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch {
  failPolicy('tracked-files-unreadable');
}
const splitNullTerminated = (output) => {
  if (output.length === 0) return [];
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index === start) failPolicy('tracked-entry-invalid');
    records.push(output.subarray(start, index));
    start = index + 1;
  }
  if (start !== output.length) failPolicy('tracked-entry-invalid');
  return records;
};
const canonicalize = (value) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\s+/gu, ' ');
const canonicalPolicyValues = new Set();
const needles = [];
for (const category of supportedCategories) {
  for (const value of policy[category]) {
    const needle = canonicalize(value);
    if (needle.trim().length === 0) failPolicy('privacy-policy-empty-category');
    if (canonicalPolicyValues.has(needle)) {
      failPolicy('privacy-policy-duplicate-value');
    }
    canonicalPolicyValues.add(needle);
    needles.push([category, needle]);
  }
}
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
const pathDecoder = new TextDecoder('utf-8', { fatal: true });
const binaryMetadataDecoders = [
  { decoder: new TextDecoder('utf-8'), byteOffsets: [0], unitSize: 1 },
  { decoder: new TextDecoder('utf-16le'), byteOffsets: [0, 1], unitSize: 2 },
  { decoder: new TextDecoder('utf-16be'), byteOffsets: [0, 1], unitSize: 2 },
];
const decodeBinaryMetadataViews = (contents) =>
  binaryMetadataDecoders.flatMap(({ decoder, byteOffsets, unitSize }) =>
    byteOffsets.map((byteOffset) => {
      const trailingByteCount = (contents.length - byteOffset) % unitSize;
      return decoder.decode(
        contents.subarray(byteOffset, contents.length - trailingByteCount),
      );
    }),
  );
const findings = [];
const indexedEntries = new Map();
for (const record of splitNullTerminated(indexOutput)) {
  const separatorIndex = record.indexOf(0x09);
  if (separatorIndex < 0) failPolicy('tracked-entry-invalid');
  const headerBytes = record.subarray(0, separatorIndex);
  if (headerBytes.some((byte) => byte > 0x7f)) {
    failPolicy('tracked-entry-invalid');
  }
  const header = headerBytes.toString('ascii');
  const match = /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/.exec(
    header,
  );
  if (!match) failPolicy('tracked-entry-invalid');
  const [, mode, objectId, stage] = match;
  if (stage !== '0') failPolicy('tracked-entry-unmerged');
  if (mode !== '100644' && mode !== '100755') {
    failPolicy('tracked-entry-unsupported-mode');
  }
  let path;
  try {
    path = pathDecoder.decode(record.subarray(separatorIndex + 1));
  } catch {
    failPolicy('tracked-entry-invalid');
  }
  if (path.length === 0) failPolicy('tracked-entry-invalid');
  if (indexedEntries.has(path)) failPolicy('tracked-entry-invalid');
  indexedEntries.set(path, objectId);
}

for (const [path, objectId] of indexedEntries) {
  const pathnameMatches = needles.filter(([, needle]) =>
    canonicalize(path).includes(needle),
  );
  const safePath =
    pathnameMatches.length > 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(path)
      ? '<sensitive-path>'
      : path;
  for (const [category] of pathnameMatches) {
    findings.push(`[${category}] ${safePath}`);
  }

  let contents;
  try {
    contents = execFileSync('git', ['cat-file', 'blob', objectId], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    failPolicy('indexed-blob-unreadable');
  }
  const recognizedBinary = knownBinarySignatures.some((matches) =>
    matches(contents),
  );
  if (!recognizedBinary && contents.includes(0)) {
    findings.push(`[unrecognized-binary] ${safePath}`);
    continue;
  }
  let candidateTexts;
  if (recognizedBinary) {
    candidateTexts = decodeBinaryMetadataViews(contents);
  } else {
    try {
      candidateTexts = [textDecoder.decode(contents)];
    } catch {
      findings.push(`[unrecognized-binary] ${safePath}`);
      continue;
    }
  }
  for (const text of candidateTexts) {
    const candidate = canonicalize(text);
    for (const [category, needle] of needles) {
      if (candidate.includes(needle)) {
        findings.push(`[${category}] ${safePath}`);
      }
    }
  }
  if (
    credentialPrefixes.some((prefix) =>
      contents.includes(Buffer.from(prefix, 'utf8')),
    )
  ) {
    findings.push(`[credential-shape] ${safePath}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`${[...new Set(findings)].sort().join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('Independent tracked-text audit passed.\n');
NODE
```

Expected: the staged paths are only the intended `apps`, `packages`, and `e2e` changes; the scanner exits `0`; and the independent audit reports no matches. Any edit after staging must be restaged explicitly and every index-based privacy scan above rerun.

Then commit:

```bash
git commit -m "refactor: anonymize family fixtures"
```

### Task 3: Sanitize documentation and add the public README

**Files:**
- Create: `README.md`
- Modify: tracked files under `docs/**`
- Modify: any remaining tracked text reported by the privacy scanner

**Interfaces:**
- Consumes: the approved sanitization design and existing local runbook paths.
- Produces: public documentation using only fictional examples, portable paths, correct domain metadata, and a prominent LAN-only warning.

- [ ] **Step 1: Write the public README**

Create `README.md` with these sections and facts:

```markdown
# Family App

Family App is a local-first household dashboard and parent application for shared calendars, chore claiming, parent-gated approvals, adjustable rewards, and child balance tracking.

> **Current security boundary:** run this project on a trusted LAN only. The development authenticator is not approved for public ingress. Do not expose the API or dashboard through Cloudflare Tunnel until production authentication is implemented.

## Apps and packages

- `apps/api` — household data, chore workflow, approvals, balances, calendar integration, setup diagnostics, and feedback intake.
- `apps/dashboard` — touch-first kitchen display for children.
- `apps/parent` — native-style iOS and Android parent application.
- `packages/*` — shared contracts, design tokens, domain logic, and supporting libraries.

## Local development

Use Node.js 24 and pnpm 11. Start with the local setup and Ubuntu development-host instructions in [`docs/development/client-vertical-slice.md`](docs/development/client-vertical-slice.md).

The intended future public hostname is `family.jordanwaters.net`, but public ingress remains disabled until the authentication milestone is complete.

## Repository privacy

Committed examples use fictional household data. Real household information belongs only in ignored local configuration and the local database. Run `pnpm verify:public-source-privacy` before publishing changes.
```

- [ ] **Step 2: Replace family-specific documentation**

Across `docs/**`, apply the approved display map to use `Avery`, `Riley`, and `Example Family`. Rewrite real ages, birthdays, and prose about the actual family as generic product requirements; examples may say only that the dashboard is designed for young children who do not yet have personal devices.

- [ ] **Step 3: Correct hostname and infrastructure guidance**

Replace every obsolete hostname occurrence with `family.jordanwaters.net` without reproducing obsolete variants in public documentation. Replace employer-specific warnings with this general rule:

```text
Use public package registries and personal/local infrastructure only. Do not use company accounts, credentials, registries, cloud resources, or network services for this project.
```

Retain Route 53 only where documentation accurately describes it as the domain registrar and Cloudflare as authoritative DNS.

- [ ] **Step 4: Make local paths portable**

Replace absolute repository paths with `${FAMILY_APP_REPOSITORY}` in prose and shell examples. Use `${FAMILY_APP_USER_HOME}` when the wider home path is genuinely needed. Prefer repository-relative paths in Markdown links and commands.

- [ ] **Step 5: Format and stage the intended documentation changes**

Run formatting before staging:

```bash
pnpm format:check
```

If Prettier reports only intended README/docs files, run `pnpm exec prettier --write` on those exact paths and rerun `pnpm format:check`. Then stage only the intended public documentation and inspect the exact prospective index:

```bash
git add -- README.md docs
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git diff --cached -- README.md docs
```

- [ ] **Step 6: Run the privacy gate and independent text audit, then commit**

Run:

```bash
node scripts/test-verify-public-source-privacy.mjs
pnpm verify:public-source-privacy
node --input-type=module - <<'NODE'
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

const policyPath = resolve('.local/public-source-privacy-denylist.json');
const supportedCategories = [
  'child-name',
  'household-name',
  'prohibited-account',
  'obsolete-hostname',
  'local-user-path',
  'company-infrastructure',
];
const supportedCategorySet = new Set(supportedCategories);
const failPolicy = (category) => {
  process.stderr.write(`[${category}]\n`);
  process.exit(1);
};
let policyStatus;
try {
  policyStatus = lstatSync(policyPath);
} catch (error) {
  failPolicy(
    error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
      ? 'privacy-policy-missing'
      : 'privacy-policy-unreadable',
  );
}
if (policyStatus.isSymbolicLink()) {
  failPolicy('privacy-policy-insecure-permissions');
}
if (!policyStatus.isFile()) failPolicy('privacy-policy-unreadable');
let policyDirectoryStatus;
try {
  policyDirectoryStatus = lstatSync(dirname(policyPath));
} catch {
  failPolicy('privacy-policy-unreadable');
}
if (
  policyDirectoryStatus.isSymbolicLink() ||
  !policyDirectoryStatus.isDirectory() ||
  (policyStatus.mode & 0o777) !== 0o600 ||
  (policyDirectoryStatus.mode & 0o077) !== 0
) {
  failPolicy('privacy-policy-insecure-permissions');
}
let policyText;
try {
  policyText = readFileSync(policyPath, 'utf8');
} catch {
  failPolicy('privacy-policy-unreadable');
}
let policy;
try {
  policy = JSON.parse(policyText);
} catch {
  failPolicy('privacy-policy-malformed');
}
if (policy === null || Array.isArray(policy) || typeof policy !== 'object') {
  failPolicy('privacy-policy-malformed');
}
if (Object.keys(policy).some((key) => !supportedCategorySet.has(key))) {
  failPolicy('privacy-policy-unsupported-category');
}
if (supportedCategories.some((key) => !Object.hasOwn(policy, key))) {
  failPolicy('privacy-policy-missing-category');
}
for (const category of supportedCategories) {
  const values = policy[category];
  if (!Array.isArray(values)) failPolicy('privacy-policy-malformed');
  if (
    values.length === 0 ||
    values.some(
      (value) => typeof value === 'string' && value.trim().length === 0,
    )
  ) {
    failPolicy('privacy-policy-empty-category');
  }
  if (values.some((value) => typeof value !== 'string')) {
    failPolicy('privacy-policy-malformed');
  }
}

let indexOutput;
try {
  indexOutput = execFileSync('git', ['ls-files', '--stage', '-z'], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  failPolicy('tracked-files-unreadable');
}
const splitNullTerminated = (output) => {
  if (output.length === 0) return [];
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index === start) failPolicy('tracked-entry-invalid');
    records.push(output.subarray(start, index));
    start = index + 1;
  }
  if (start !== output.length) failPolicy('tracked-entry-invalid');
  return records;
};
const canonicalize = (value) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/\s+/gu, ' ');
const canonicalPolicyValues = new Set();
const needles = [];
for (const category of supportedCategories) {
  for (const value of policy[category]) {
    const needle = canonicalize(value);
    if (needle.trim().length === 0) failPolicy('privacy-policy-empty-category');
    if (canonicalPolicyValues.has(needle)) {
      failPolicy('privacy-policy-duplicate-value');
    }
    canonicalPolicyValues.add(needle);
    needles.push([category, needle]);
  }
}
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
const pathDecoder = new TextDecoder('utf-8', { fatal: true });
const binaryMetadataDecoders = [
  { decoder: new TextDecoder('utf-8'), byteOffsets: [0], unitSize: 1 },
  { decoder: new TextDecoder('utf-16le'), byteOffsets: [0, 1], unitSize: 2 },
  { decoder: new TextDecoder('utf-16be'), byteOffsets: [0, 1], unitSize: 2 },
];
const decodeBinaryMetadataViews = (contents) =>
  binaryMetadataDecoders.flatMap(({ decoder, byteOffsets, unitSize }) =>
    byteOffsets.map((byteOffset) => {
      const trailingByteCount = (contents.length - byteOffset) % unitSize;
      return decoder.decode(
        contents.subarray(byteOffset, contents.length - trailingByteCount),
      );
    }),
  );
const findings = [];
const indexedEntries = new Map();
for (const record of splitNullTerminated(indexOutput)) {
  const separatorIndex = record.indexOf(0x09);
  if (separatorIndex < 0) failPolicy('tracked-entry-invalid');
  const headerBytes = record.subarray(0, separatorIndex);
  if (headerBytes.some((byte) => byte > 0x7f)) {
    failPolicy('tracked-entry-invalid');
  }
  const header = headerBytes.toString('ascii');
  const match = /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/.exec(
    header,
  );
  if (!match) failPolicy('tracked-entry-invalid');
  const [, mode, objectId, stage] = match;
  if (stage !== '0') failPolicy('tracked-entry-unmerged');
  if (mode !== '100644' && mode !== '100755') {
    failPolicy('tracked-entry-unsupported-mode');
  }
  let path;
  try {
    path = pathDecoder.decode(record.subarray(separatorIndex + 1));
  } catch {
    failPolicy('tracked-entry-invalid');
  }
  if (path.length === 0) failPolicy('tracked-entry-invalid');
  if (indexedEntries.has(path)) failPolicy('tracked-entry-invalid');
  indexedEntries.set(path, objectId);
}

for (const [path, objectId] of indexedEntries) {
  const pathnameMatches = needles.filter(([, needle]) =>
    canonicalize(path).includes(needle),
  );
  const safePath =
    pathnameMatches.length > 0 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(path)
      ? '<sensitive-path>'
      : path;
  for (const [category] of pathnameMatches) {
    findings.push(`[${category}] ${safePath}`);
  }

  let contents;
  try {
    contents = execFileSync('git', ['cat-file', 'blob', objectId], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    failPolicy('indexed-blob-unreadable');
  }
  const recognizedBinary = knownBinarySignatures.some((matches) =>
    matches(contents),
  );
  if (!recognizedBinary && contents.includes(0)) {
    findings.push(`[unrecognized-binary] ${safePath}`);
    continue;
  }
  let candidateTexts;
  if (recognizedBinary) {
    candidateTexts = decodeBinaryMetadataViews(contents);
  } else {
    try {
      candidateTexts = [textDecoder.decode(contents)];
    } catch {
      findings.push(`[unrecognized-binary] ${safePath}`);
      continue;
    }
  }
  for (const text of candidateTexts) {
    const candidate = canonicalize(text);
    for (const [category, needle] of needles) {
      if (candidate.includes(needle)) {
        findings.push(`[${category}] ${safePath}`);
      }
    }
  }
  if (
    credentialPrefixes.some((prefix) =>
      contents.includes(Buffer.from(prefix, 'utf8')),
    )
  ) {
    findings.push(`[credential-shape] ${safePath}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`${[...new Set(findings)].sort().join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('Independent tracked-text audit passed.\n');
NODE
git ls-files .local
```

Expected: the self-test and privacy scan pass against the staged prospective tree; the independent audit reports no matches; and `git ls-files .local` prints nothing. Any edit after staging must be restaged explicitly and every index-based privacy scan above rerun.

Then commit the already inspected index:

```bash
git commit -m "docs: prepare public repository"
```

### Task 4: Verify the sanitized branch as a release candidate

**Files:**
- Modify: only files required to correct failures introduced by Tasks 1–3
- Inspect: all tracked files and generated production bundles

**Interfaces:**
- Consumes: the fully sanitized working branch.
- Produces: one clean, reviewed source tree that passes every existing and new release gate under Node.js 24.

- [ ] **Step 1: Confirm runtime and dependency state**

Run:

```bash
node --version
pnpm --version
git status --short
```

Expected: Node reports `v24.x`, pnpm reports `11.x`, and the worktree is clean.

- [ ] **Step 2: Run static and unit gates**

Run each command separately and stop at the first failure:

```bash
node scripts/test-verify-public-source-privacy.mjs
pnpm verify:public-source-privacy
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: every command exits `0`.

- [ ] **Step 3: Run schema, build, and end-to-end gates**

Run:

```bash
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
pnpm build
pnpm test:e2e
pnpm verify:no-github-credentials
node scripts/verify-no-credential-leaks.mjs
pnpm verify:production-bundles
```

Expected: migrations verify, builds and end-to-end fixture generation complete before the generated credential scans, end-to-end tests pass, and production exports pass all three independent privacy/credential scanners.

- [ ] **Step 4: Audit the exact publication tree**

Run:

```bash
git status --short
git diff HEAD^ --stat
git ls-files -z | xargs -0 file
git ls-files .local
git tag --list
git remote -v
```

Review the complete `git diff HEAD^` plus all commits added on the sanitization branch. Confirm generated `dist` trees, `.local`, database files, environment files, tokens, and recovery artifacts are untracked. Confirm no remote exists yet.

- [ ] **Step 5: Record the verified sanitized tree**

Capture the immutable values used by the rewrite:

```bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --porcelain=v1
```

Expected: the status output is empty. Save the commit and tree IDs in the execution log without adding a tracked file.

### Task 5: Preserve old history locally and replace `main` with one root commit

**Files:**
- Create, ignored: `.local/backups/family-app-pre-public.bundle`
- Copy, ignored: `.local/public-source-privacy-denylist.json` into rewritten `main`
- Modify Git refs: `refs/heads/main`
- Delete local-only ref after use: the sanitization branch

**Interfaces:**
- Consumes: the verified sanitized tree ID, expected pre-rewrite `main` commit, and active GitHub identity for `1waterrj`.
- Produces: a verified local recovery bundle and a local `main` with exactly one reachable root commit using a public-safe noreply email.

- [ ] **Step 1: Confirm the active GitHub identity**

Run:

```bash
gh auth status
gh api user --jq '[.id, .login] | @tsv'
git config --get user.name
git config --get user.email
```

Expected: GitHub login is exactly `1waterrj`. Construct the public-safe author email as `<numeric-id>+1waterrj@users.noreply.github.com`. Stop if the login, remote state, or identity differs.

- [ ] **Step 2: Create and verify the local recovery bundle**

From the original repository worktree, create the ignored backup directory with owner-only permissions, then create the bundle from every current ref:

```bash
mkdir -p -m 700 .local/backups
git bundle create .local/backups/family-app-pre-public.bundle --all
git bundle verify .local/backups/family-app-pre-public.bundle
git ls-files .local/backups/family-app-pre-public.bundle
```

Expected: bundle verification succeeds and the final command prints nothing.

- [ ] **Step 3: Create the public root commit without moving refs**

Using the captured sanitized tree and public-safe identity, run `git commit-tree` with author and committer set to the same public identity and message `Initial public release`. The exact environment variables are:

```bash
GIT_AUTHOR_NAME='Jordan Waters'
GIT_AUTHOR_EMAIL='<numeric-id>+1waterrj@users.noreply.github.com'
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
```

Pass no `-p` option so the resulting commit has no parent. Inspect it with:

```bash
git cat-file -p <new-root-commit>
git rev-list --count <new-root-commit>
git diff --exit-code <sanitized-branch>^{tree} <new-root-commit>^{tree}
```

Expected: no `parent` line, commit count `1`, and identical trees.

- [ ] **Step 4: Move `main` only after compare-and-swap checks**

In the main worktree, confirm status is empty and `git rev-parse main` equals the pre-rewrite commit recorded before isolation. Detach without changing files, force `main` to the new root only after those checks, and switch back:

```bash
git switch --detach
git branch -f main <new-root-commit>
git switch main
mkdir -p -m 700 <main-worktree-path>/.local
install -m 600 <sanitization-worktree-path>/.local/public-source-privacy-denylist.json <main-worktree-path>/.local/public-source-privacy-denylist.json
```

Expected: the working tree remains clean, `git rev-list --count main` prints `1`,
and rewritten `main` has an untracked owner-only policy ready for Task 6.

- [ ] **Step 5: Remove old-history refs without deleting the recovery bundle**

Remove the isolated worktree through `git worktree remove <sanitization-worktree-path>`, delete its local sanitization branch, then run:

```bash
git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags
git rev-list --count main
git bundle verify .local/backups/family-app-pre-public.bundle
```

Expected: only `refs/heads/main` is listed, no tags are listed, `main` has one commit, and the recovery bundle still verifies.

### Task 6: Re-verify rewritten `main`

**Files:**
- Inspect: rewritten `main`, ignored privacy policy, and ignored recovery artifact

**Interfaces:**
- Consumes: the one-commit `main` created in Task 5.
- Produces: publication approval only if the exact root tree passes every privacy and release gate.

- [ ] **Step 1: Re-run privacy and credential gates**

```bash
node -e 'const { statSync } = require("node:fs"); if ((statSync(".local").mode & 0o777) !== 0o700 || (statSync(".local/public-source-privacy-denylist.json").mode & 0o777) !== 0o600) process.exit(1)'
node scripts/test-verify-public-source-privacy.mjs
pnpm verify:public-source-privacy
```

Expected: every command exits `0`.

- [ ] **Step 2: Re-run the complete release gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:no-github-credentials
node scripts/verify-no-credential-leaks.mjs
pnpm verify:production-bundles
```

Then run:

```bash
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
```

Expected: every command exits `0`.

- [ ] **Step 3: Verify one-commit publication invariants**

```bash
git status --short
git rev-list --count main
git log --format=fuller --decorate --max-count=1 main
git for-each-ref --format='%(refname)' refs/heads refs/tags
git remote -v
git ls-files .local
git bundle verify .local/backups/family-app-pre-public.bundle
```

Expected: clean status, count `1`, public-safe author/committer identity, only `refs/heads/main`, no remote, no tracked `.local` files, and a valid recovery bundle.

### Task 7: Create and inspect the public GitHub repository

**Files:**
- Modify Git configuration: add `origin` pointing to `https://github.com/1waterrj/family-app.git`
- Modify remote state: create public repository and push only `refs/heads/main`

**Interfaces:**
- Consumes: verified one-commit local `main` and authenticated GitHub CLI account `1waterrj`.
- Produces: public GitHub repository `https://github.com/1waterrj/family-app` with issues enabled and only the sanitized `main` branch.

- [ ] **Step 1: Reconfirm destination availability and identity**

```bash
gh api user --jq .login
gh repo view 1waterrj/family-app
git remote -v
```

Expected: login `1waterrj`, repository lookup reports not found, and no local remote exists. A found repository or any unexpected remote is a stop condition.

- [ ] **Step 2: Create the empty public repository**

```bash
gh repo create 1waterrj/family-app --public --description "Local-first family dashboard, chores, rewards, calendars, and parent app" --enable-issues --disable-wiki
```

Do not use `--add-readme`, `--clone`, `--source`, or `--push`; GitHub must create no server-side initial commit.

- [ ] **Step 3: Attach the exact origin and push only `main`**

```bash
git remote add origin https://github.com/1waterrj/family-app.git
git push --set-upstream origin refs/heads/main:refs/heads/main
```

Do not run `git push --all`, `git push --mirror`, or `git push --tags`.

- [ ] **Step 4: Inspect GitHub metadata and all remote refs**

```bash
gh repo view 1waterrj/family-app --json nameWithOwner,url,visibility,hasIssuesEnabled,defaultBranchRef
git ls-remote --heads --tags origin
git fetch origin main
git rev-list --count origin/main
git diff --exit-code main^{tree} origin/main^{tree}
```

Expected: `nameWithOwner` is `1waterrj/family-app`, visibility is `PUBLIC`, issues are enabled, default branch is `main`, the remote lists only `refs/heads/main`, commit count is `1`, and local/remote trees are identical.

- [ ] **Step 5: Perform a clean remote privacy audit**

Create an owner-only temporary directory, clone only `main` from the public URL,
copy the ignored owner policy into the clone without printing it, and run:

```bash
privacy_policy_source="$(pwd)/.local/public-source-privacy-denylist.json"
audit_root=<owner-only-temp-directory>
mkdir -p -m 700 "$audit_root"
git clone --single-branch --branch main https://github.com/1waterrj/family-app.git "$audit_root/family-app"
mkdir -p -m 700 "$audit_root/family-app/.local"
install -m 600 "$privacy_policy_source" "$audit_root/family-app/.local/public-source-privacy-denylist.json"
cd "$audit_root/family-app"
git rev-list --count HEAD
node scripts/test-verify-public-source-privacy.mjs
corepack pnpm install --frozen-lockfile
pnpm build
pnpm test:e2e
pnpm verify:public-source-privacy
pnpm verify:no-github-credentials
node scripts/verify-no-credential-leaks.mjs
git for-each-ref --format='%(refname)' refs/remotes refs/tags
```

Expected: one commit, the ignored policy remains owner-only and untracked, all
build and end-to-end fixture generation completes before generated credential
scans, all scans pass, no tags exist, and only the remote default branch is
present. Remove the temporary clone after recording the results.

- [ ] **Step 6: Preserve recovery and hand off the repository**

Confirm `.local/backups/family-app-pre-public.bundle` still verifies and remains untracked. Report the public URL, root commit ID, verification commands, LAN-only ingress warning, and the exact backup path. Do not report any private scanner matches or token-shaped fixture content.
