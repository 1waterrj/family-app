# Core Client Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a native-style parent app and Raspberry Pi-ready kitchen PWA
that complete the pictured chore create, claim, submit, approve, and reward
workflow against the existing server-authoritative API.

**Architecture:** Keep `apps/parent` and `apps/dashboard` as separate clients
with platform-specific UI. Share wire contracts, a headless API client, design
tokens, and a chore-image catalogue. Add coherent parent/dashboard snapshot
endpoints and a development-only fixture workflow while retaining the API's
hard production-authentication refusal.

**Tech Stack:** Node.js 24, pnpm 11.16.0, TypeScript 6, PostgreSQL 17, Fastify 5,
Drizzle ORM, Zod 4, Expo SDK 57/React Native 0.86/Expo Router 57, React 19,
TanStack Query 5, Vite 8, Vitest 4, Jest Expo, React Native Testing Library,
Playwright, and Vite PWA/Workbox.

## Global Constraints

- Use Node.js `>=24 <25`, pnpm `11.16.0`, and PostgreSQL `17-alpine`.
- Pin the framework/toolchain releases listed below exactly. Install Expo-native
  modules with Expo's SDK compatibility resolver and commit its compatible
  ranges plus the exact resolved `pnpm-lock.yaml`.
- Use stable releases only: Expo `57.0.11`, React Native `0.86.2`, React
  `19.2.3`, Expo Router `57.0.7`, Vite `8.0.16`,
  `@vitejs/plugin-react` `6.0.4`, `vite-plugin-pwa` `1.3.0`, and TanStack Query
  packages `5.100.14`, and Playwright `1.62.0`.
- Keep parent and dashboard screens separate; share headless code and tokens,
  not screen components.
- Store money as integer cents. Reject fractional cents instead of rounding.
- Store timestamps in UTC and render them in the household IANA time zone.
- Keep all chore state transitions, deadlines, permissions, approvals, and
  balances server-authoritative.
- Require one UUID idempotency key per mutation operation and reuse it only for
  retries of that same operation.
- Never put development tokens in tracked files, screenshots, normal logs, or
  production bundles.
- Preserve production startup refusal unless a non-development
  `ActorAuthenticator` is configured.
- Dashboard touch targets are at least `64px` on the shortest side and no status
  relies on color alone.
- Dashboard polling is five seconds with active/waiting chores and thirty
  seconds otherwise. Parent approval polling is fifteen seconds only while the
  inbox is nonempty and the app is foregrounded.
- Do not add calendar, push, production sign-in, public ingress, arbitrary image
  upload, savings goals, celebrations, or Home Assistant behavior in this plan.
- Preserve the exact published `0000_core.sql` migration and existing journal
  ordering; all schema changes are new forward migrations.
- Follow strict TDD for behavior changes. Generated image assets are the only
  non-code exception and still require catalogue and dimension verification.

## Target File Map

```text
apps/
├── api/
│   └── src/
│       ├── dev/                    # deterministic local fixture seed
│       └── snapshots/              # role-specific coherent reads
├── parent/
│   ├── app/                        # Expo Router routes
│   ├── src/                        # session, query, screens, components
│   └── test/                       # Jest Expo component tests
└── dashboard/
    ├── public/                     # PWA icons and manifest assets
    ├── src/                        # kiosk shell, query, screens, components
    └── test/                       # Vitest component tests
packages/
├── api-client/                     # headless fetch, errors, query keys, money
├── chore-images/                   # catalogue metadata and raster files
├── contracts/                      # wire schemas and inferred types
└── design-tokens/                  # platform-neutral visual constants
```

---

### Task 1: Chore Picture Contracts, Catalogue, and Design Tokens

**Files:**

- Modify: `packages/contracts/src/chores.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Create: `packages/chore-images/package.json`
- Create: `packages/chore-images/tsconfig.json`
- Create: `packages/chore-images/src/index.ts`
- Create: `packages/chore-images/test/catalog.test.ts`
- Create: `packages/chore-images/assets/*.png`
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/tsconfig.json`
- Create: `packages/design-tokens/src/index.ts`
- Create: `packages/design-tokens/test/tokens.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces:
  `ChoreImageKeySchema`, `ChoreImageKey`, `CHORE_IMAGE_KEYS`,
  `choreImageCatalog`, `choreImageAssetFilename`, `familyTokens`, and
  `statusPresentation`.
- Contracted keys, in order:
  `tidy-toys`, `dishes`, `set-table`, `laundry`, `feed-pet`, `make-bed`,
  `wipe-counter`, `help-garden`.
- `CreateChoreTemplate.imageKey` is required. `ChoreTemplate.imageKey` and
  `ChoreInstance.imageKey` are nullable so exact legacy rows remain readable.

- [ ] **Step 1: Write failing contract and catalogue tests**

Add literal expectations that fail until the contracted keys and client
catalogue exist:

```ts
expect(CHORE_IMAGE_KEYS).toEqual([
  'tidy-toys',
  'dishes',
  'set-table',
  'laundry',
  'feed-pet',
  'make-bed',
  'wipe-counter',
  'help-garden',
]);

expect(() =>
  CreateChoreTemplateSchema.parse({
    householdId: crypto.randomUUID(),
    name: 'Tidy toys',
    instructions: 'Put the toys in their bins.',
    defaultValueCents: 200,
    defaultDurationMinutes: 15,
    idempotencyKey: crypto.randomUUID(),
  }),
).toThrow();

expect(choreImageCatalog.map(({ key, label, assetFilename }) => ({
  key,
  label,
  assetFilename,
}))).toEqual([
  { key: 'tidy-toys', label: 'Tidy toys', assetFilename: 'tidy-toys.png' },
  { key: 'dishes', label: 'Dishes', assetFilename: 'dishes.png' },
  { key: 'set-table', label: 'Set the table', assetFilename: 'set-table.png' },
  { key: 'laundry', label: 'Laundry', assetFilename: 'laundry.png' },
  { key: 'feed-pet', label: 'Feed a pet', assetFilename: 'feed-pet.png' },
  { key: 'make-bed', label: 'Make the bed', assetFilename: 'make-bed.png' },
  { key: 'wipe-counter', label: 'Wipe a counter', assetFilename: 'wipe-counter.png' },
  { key: 'help-garden', label: 'Help in the garden', assetFilename: 'help-garden.png' },
]);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter @family/contracts build
pnpm exec vitest run packages/contracts/test/contracts.test.ts packages/chore-images/test/catalog.test.ts packages/design-tokens/test/tokens.test.ts
```

Expected: FAIL because the new packages and exports do not exist and template
input accepts no picture key.

- [ ] **Step 3: Implement the wire schema and package metadata**

Add this source-of-truth enum to `packages/contracts/src/chores.ts` and carry the
nullable key through response schemas:

```ts
export const CHORE_IMAGE_KEYS = [
  'tidy-toys',
  'dishes',
  'set-table',
  'laundry',
  'feed-pet',
  'make-bed',
  'wipe-counter',
  'help-garden',
] as const;

export const ChoreImageKeySchema = z.enum(CHORE_IMAGE_KEYS);
export type ChoreImageKey = z.infer<typeof ChoreImageKeySchema>;
```

Extend schemas exactly as follows:

```ts
export const CreateChoreTemplateSchema = z.object({
  householdId: HouseholdIdSchema,
  name: z.string().trim().min(1).max(120),
  imageKey: ChoreImageKeySchema,
  imageUrl: z.url().optional(),
  instructions: z.string().trim().min(1).max(2_000),
  defaultValueCents: MoneyCentsSchema.nonnegative(),
  defaultDurationMinutes: z.number().int().positive().max(24 * 60),
  idempotencyKey: z.uuid(),
});
```

Add `imageKey: ChoreImageKeySchema.nullable()` to both response schemas.
`PublishChoreInstanceSchema` does not accept an image override; the instance
always snapshots the template key.

- [ ] **Step 4: Implement catalogue and token packages**

`packages/chore-images/src/index.ts` must import `ChoreImageKey` from contracts
and export an exhaustive literal catalogue. `packages/design-tokens/src/index.ts`
must export these minimum values:

```ts
export const familyTokens = {
  color: {
    canvas: '#FFF9F0',
    surface: '#FFFFFF',
    ink: '#253238',
    mutedInk: '#5D6A70',
    primary: '#7B61A8',
    secondary: '#197C83',
    success: '#26734D',
    warning: '#9A5B00',
    danger: '#A12B2B',
    focus: '#155EEF',
  },
  radius: { small: 12, medium: 20, large: 28, pill: 999 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  touch: { phoneMinimum: 48, dashboardMinimum: 64 },
  motion: { quickMs: 120, standardMs: 220 },
} as const;

export const statusPresentation = {
  AVAILABLE: { label: 'Ready', symbol: '○' },
  CLAIMED: { label: 'In progress', symbol: '▶' },
  AWAITING_APPROVAL: { label: 'Waiting for a grown-up', symbol: '…' },
  APPROVED: { label: 'Approved', symbol: '✓' },
  CLOSED: { label: 'Closed', symbol: '■' },
} as const;
```

- [ ] **Step 5: Generate and verify the eight raster assets**

Use the `imagegen` skill to generate eight consistent square PNG illustrations:
warm paper texture, rounded shapes, no text, no faces, no brand marks, clear at
128px, and distinct without relying on color. Save each as a `512x512` PNG under
`packages/chore-images/assets/` with its contracted key as the filename.

Run:

```bash
file packages/chore-images/assets/*.png
```

Expected: eight PNG images, each `512 x 512`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run packages/contracts/test/contracts.test.ts packages/chore-images/test/catalog.test.ts packages/design-tokens/test/tokens.test.ts
pnpm --filter @family/contracts build
pnpm --filter @family/chore-images build
pnpm --filter @family/design-tokens build
pnpm typecheck
```

Commit:

```bash
git add packages/contracts packages/chore-images packages/design-tokens pnpm-lock.yaml
git commit -m "feat: add family chore picture system"
```

---

### Task 2: Persist Chore Picture Keys Forward

**Files:**

- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/chores/repository.ts`
- Modify: `apps/api/src/chores/service.ts`
- Modify: `apps/api/test/chores.test.ts`
- Modify: `apps/api/test/api.test.ts`
- Modify: `apps/api/test/e2e.test.ts`
- Modify: `apps/api/test/schema.test.ts`
- Create: `db/migrations/0009_chore-image-keys.sql`
- Create: `db/migrations/meta/0009_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`

**Interfaces:**

- `CreateTemplateRecord.imageKey: ChoreImageKey`
- `CreateInstanceRecord.imageKey: ChoreImageKey | null`
- `toChoreTemplate` and `toChoreInstance` include `imageKey`.
- Existing rows with `NULL image_key` remain readable; all API-created templates
  have a key and published instances snapshot it.

- [ ] **Step 1: Write failing persistence and migration tests**

Add a schema test that migrates an exact pre-`0009` database, proves existing
rows remain `NULL`, and proves new keyed rows round-trip:

```ts
expect(legacyTemplate.image_key).toBeNull();
expect(legacyInstance.image_key).toBeNull();
expect(keyedTemplate.image_key).toBe('tidy-toys');
expect(keyedInstance.image_key).toBe('tidy-toys');
```

Update the core chore test to create a template with `imageKey: 'tidy-toys'`
and assert its published instance carries the same key.

- [ ] **Step 2: Run focused tests and confirm RED**

On macOS with Colima, define the portable home-directory placeholder once
before running commands that reference its local socket:

```bash
export FAMILY_APP_USER_HOME='/absolute/path/to/your/home'
```

Do not replace the shell's `HOME` variable.

Run:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @family/api exec vitest run test/schema.test.ts test/chores.test.ts
```

Expected: FAIL because schema columns and service mappings do not exist.

- [ ] **Step 3: Add the forward migration and Drizzle columns**

Create the new SQL without editing any prior migration:

```sql
ALTER TABLE "chore_templates" ADD COLUMN "image_key" varchar(64);
ALTER TABLE "chore_instances" ADD COLUMN "image_key" varchar(64);

ALTER TABLE "chore_templates"
  ADD CONSTRAINT "chore_templates_image_key_known"
  CHECK (
    "image_key" IS NULL OR "image_key" IN (
      'tidy-toys', 'dishes', 'set-table', 'laundry',
      'feed-pet', 'make-bed', 'wipe-counter', 'help-garden'
    )
  ) NOT VALID;

ALTER TABLE "chore_instances"
  ADD CONSTRAINT "chore_instances_image_key_known"
  CHECK (
    "image_key" IS NULL OR "image_key" IN (
      'tidy-toys', 'dishes', 'set-table', 'laundry',
      'feed-pet', 'make-bed', 'wipe-counter', 'help-garden'
    )
  ) NOT VALID;
```

Add nullable `varchar('image_key', { length: 64 })` columns and matching Drizzle
checks. Generate and inspect `0009_snapshot.json`; append one journal entry after
the current `0008` entry.

- [ ] **Step 4: Carry the key through create and publish**

Use the contracted type in repository records and map fields literally:

```ts
const record: CreateTemplateRecord = {
  createdByParentId: parent.actorId,
  name: input.name,
  imageKey: input.imageKey,
  imageUrl: input.imageUrl,
  instructions: input.instructions,
  defaultValueCents: input.defaultValueCents,
  defaultDurationSeconds: input.defaultDurationMinutes * 60,
};

const instanceRecord: CreateInstanceRecord = {
  choreTemplateId: template.id,
  name: template.name,
  imageKey: template.imageKey,
  imageUrl: template.imageUrl,
  instructions: input.instructions ?? template.instructions,
  valueCents: input.valueCents ?? template.defaultValueCents,
  durationSeconds:
    input.durationMinutes === undefined
      ? template.defaultDurationSeconds
      : input.durationMinutes * 60,
};
```

Update every existing template-creation fixture with one of the eight literal
keys; do not weaken the input schema to preserve old tests.

- [ ] **Step 5: Verify migration replay and commit**

Run:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @family/api exec vitest run test/schema.test.ts test/chores.test.ts test/api.test.ts test/e2e.test.ts
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
git diff --check
```

Commit:

```bash
git add apps/api/src apps/api/test db/migrations packages/contracts pnpm-lock.yaml
git commit -m "feat: persist chore picture keys"
```

---

### Task 3: Parent and Dashboard Snapshot Endpoints

**Files:**

- Create: `packages/contracts/src/snapshots.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/contracts.test.ts`
- Create: `apps/api/src/snapshots/repository.ts`
- Create: `apps/api/src/snapshots/service.ts`
- Create: `apps/api/src/snapshots/routes.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/snapshots.test.ts`
- Modify: `apps/api/test/api.test.ts`

**Interfaces:**

```ts
export interface SnapshotService {
  getParentSnapshot(actor: ActorContext): Promise<ParentSnapshot>;
  getDashboardSnapshot(actor: ActorContext): Promise<DashboardSnapshot>;
}

export type ParentSnapshot = {
  household: Household;
  serverTime: string;
  children: Array<{ profile: ChildProfile; balanceCents: number }>;
  templates: ChoreTemplate[];
  chores: ChoreInstance[];
  pendingApprovals: Array<{
    submissionAttemptId: string;
    child: ChildProfile;
    chore: ChoreInstance;
    claimedAt: string | null;
    submittedAt: string;
  }>;
};

export type DashboardSnapshot = {
  household: Pick<Household, 'id' | 'name' | 'timeZone'>;
  serverTime: string;
  children: Array<{ profile: ChildProfile; balanceCents: number }>;
  chores: DashboardChore[];
};
```

`DashboardChore` contains only ID, template ID, name, picture fields,
instructions, value, duration, status, claimed child ID, deadline, submitted
time, and created time. It omits household ID and all approval/audit actors.

- [ ] **Step 1: Write failing contract and API privacy tests**

Add schema literals for a minimal parent and dashboard snapshot. In
`apps/api/test/snapshots.test.ts`, insert a private ledger note and approval
decision, fetch both snapshots, and assert:

```ts
expect(parent.pendingApprovals[0]?.submissionAttemptId).toBe(attempt.id);
expect(parent.children[0]?.balanceCents).toBe(425);

expect(JSON.stringify(dashboard)).not.toMatch(
  /private note|actorParentId|approvalDecisionId|submissionAttemptId/,
);
expect(Object.keys(dashboard).sort()).toEqual([
  'children',
  'chores',
  'household',
  'serverTime',
]);
```

Also assert parent access to `/v1/dashboard/snapshot` and dashboard access to
`/v1/parent/snapshot` each return `403 FORBIDDEN`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @family/api exec vitest run test/snapshots.test.ts test/api.test.ts
```

Expected: FAIL because snapshot schemas, service, and routes do not exist.

- [ ] **Step 3: Implement snapshot schemas**

Build schemas from existing contract schemas rather than parallel handwritten
types. Use `z.object`, `pick`, and `array`; export inferred types. Make
`ParentSnapshotSchema` strict enough that unexpected dashboard-unsafe keys are
rejected.

- [ ] **Step 4: Implement one coherent repository read**

`SnapshotRepository` exposes transaction-scoped methods:

```ts
findHousehold(transaction, householdId)
findParentMembership(transaction, householdId, parentId)
findDashboardDevice(transaction, householdId, dashboardId)
listChildrenWithBalances(transaction, householdId)
listActiveTemplates(transaction, householdId)
listOpenChores(transaction, householdId)
listPendingApprovals(transaction, householdId)
```

Use aggregate SQL grouped by child for balances and `LEFT JOIN` so children with
no ledger rows return zero. Pending approvals join the current submission
attempt to its child and `AWAITING_APPROVAL` chore, exclude attempts with an
existing decision, and order by `submitted_at ASC, id ASC`. Resolve `claimedAt`
from the most recent transition into `CLAIMED` at or before that attempt's
submission; return `null` if legacy data has no matching transition.

- [ ] **Step 5: Implement role guards, repeatable reads, and routes**

`SnapshotService` must call `requireParent` or `requireDashboard`, verify the
corresponding membership/device row exists, and execute all repository reads in
one transaction:

```ts
return this.database.transaction(
  async (transaction) => this.buildParentSnapshot(transaction, parent),
  { isolationLevel: 'repeatable read' },
);
```

Construct it in `buildApp` as `new SnapshotService(database, clock)` so
`serverTime` comes from the same injected clock used by the chore lifecycle;
never call `new Date()` inside snapshot assembly.

Register:

```ts
app.get('/parent/snapshot', async (request) =>
  ParentSnapshotSchema.parse(
    await snapshotService.getParentSnapshot(requestActor(request)),
  ),
);

app.get('/dashboard/snapshot', async (request) =>
  DashboardSnapshotSchema.parse(
    await snapshotService.getDashboardSnapshot(requestActor(request)),
  ),
);
```

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @family/api exec vitest run test/snapshots.test.ts test/api.test.ts
pnpm --filter @family/contracts build
pnpm typecheck
```

Commit:

```bash
git add packages/contracts apps/api/src/snapshots apps/api/src/app.ts apps/api/test
git commit -m "feat: expose role-safe family snapshots"
```

---

### Task 4: Shared Headless API Client

**Files:**

- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/src/client.ts`
- Create: `packages/api-client/src/errors.ts`
- Create: `packages/api-client/src/money.ts`
- Create: `packages/api-client/src/query-keys.ts`
- Create: `packages/api-client/src/development-credential.ts`
- Create: `packages/api-client/src/index.ts`
- Create: `packages/api-client/test/client.test.ts`
- Create: `packages/api-client/test/money.test.ts`
- Create: `packages/api-client/test/query-keys.test.ts`
- Create: `packages/api-client/test/development-credential.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

```ts
export type FamilyApiClientOptions = {
  apiOrigin: string;
  accessToken: string;
  fetch: typeof globalThis.fetch;
};

export interface FamilyApiClient {
  getParentSnapshot(): Promise<ParentSnapshot>;
  getDashboardSnapshot(): Promise<DashboardSnapshot>;
  createTemplate(input: CreateChoreTemplate): Promise<ChoreTemplate>;
  publishChore(input: PublishChoreInstance): Promise<ChoreInstance>;
  claimChore(input: ClaimChore): Promise<ChoreInstance>;
  submitChore(input: SubmitChore): Promise<ChoreSubmissionResult>;
  approveChore(input: ApproveChore): Promise<ChoreDecisionResult>;
  rejectChore(input: RejectChore): Promise<ChoreDecisionResult>;
  getLedger(childId: string): Promise<LedgerSummary>;
  recordLedgerEntry(input: ManualLedgerEntry): Promise<LedgerTransaction>;
}

export type ClientSession = {
  apiOrigin: string;
  accessToken: string;
  actorId: string;
  householdId: string;
  role: 'PARENT' | 'DASHBOARD';
};
```

- [ ] **Step 1: Write failing request, error, money, and cache-key tests**

Use a real fake `fetch` boundary that records `Request` values. Prove a retry
uses the same input idempotency key and that the key is sent only in the header:

```ts
expect(request.headers.get('authorization')).toBe('Bearer signed.fixture');
expect(request.headers.get('idempotency-key')).toBe(operationKey);
expect(await request.json()).toEqual({ childId });
```

Money literals:

```ts
expect(parseUnsignedDollars('12.34')).toBe(1234);
expect(parseSignedDollars('-12.34')).toBe(-1234);
expect(() => parseUnsignedDollars('1.005')).toThrow();
expect(formatCents(-1234, 'en-US')).toBe('-$12.34');
```

Query-key literals must include origin, household, actor, and role.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run packages/api-client/test
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the request executor and normalized errors**

Create one private executor with this behavior:

```ts
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(new URL(path, apiOrigin), {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw toFamilyApiError(response.status, payload);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw FamilyApiError.malformedResponse();
  return parsed.data;
}
```

`FamilyApiError.kind` is one of `AUTHENTICATION`, `FORBIDDEN`, `NOT_FOUND`,
`CONFLICT`, `VALIDATION`, `OFFLINE`, `UNAVAILABLE`, or `UNEXPECTED`. Preserve
contracted field errors and request ID, but never expose raw response bodies.
Normalize fetch/network failures to `OFFLINE`, `502`/`503`/`504` responses to
`UNAVAILABLE`, and invalid success bodies to `UNEXPECTED` without swallowing an
`AbortError`.

- [ ] **Step 4: Implement endpoint methods and development credential parsing**

Mutation methods accept the existing full contract input, remove
`idempotencyKey` from JSON, and send it as the header. Parse the first base64url
segment of the development token only to construct local cache metadata; label
the result untrusted and rely on the server for authentication.

`parseDevelopmentCredential` accepts exactly:

```json
{
  "version": 1,
  "apiOrigin": "http://127.0.0.1:3000",
  "accessToken": "claims.signature"
}
```

It returns a normalized `ClientSession` only when the decoded claims contain a
UUID actor, UUID household, and `PARENT` or `DASHBOARD` role.

Give the parser module the literal marker
`development-fixture-token-claims`, mark the package `"sideEffects": false`,
and keep the parser out of ordinary client factory imports so production
tree-shaking has a testable boundary.

- [ ] **Step 5: Implement exact money and query helpers**

Parse strings with regular expressions and integer string arithmetic; never use
floating point multiplication. `parseUnsignedDollars` accepts `0`, `0.5`, and
`12.34`; `parseSignedDollars` additionally accepts `+12.34` and `-12.34`; both
reject commas, exponents, more than two decimals, and PostgreSQL `int4`
overflow.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run packages/api-client/test
pnpm --filter @family/api-client build
pnpm typecheck
pnpm lint
```

Commit:

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "feat: add typed family API client"
```

---

### Task 5: Deterministic Development Household Seed

**Files:**

- Create: `apps/api/src/dev/seed.ts`
- Create: `apps/api/src/dev/seed-cli.ts`
- Create: `apps/api/test/dev-seed.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `scripts/dev-seed.sh`

**Interfaces:**

```ts
export type SeedDevelopmentHouseholdOptions = {
  database: Database;
  developmentAuthSecret: string;
  parentApiOrigin: string;
  dashboardApiOrigin: string;
  outputDirectory: string;
  now: Date;
};

export type SeedDevelopmentHouseholdResult = {
  householdId: string;
  parentId: string;
  dashboardId: string;
  primaryChildId: string;
  secondaryChildId: string;
  parentCredentialPath: string;
  dashboardCredentialPath: string;
};
```

- [ ] **Step 1: Write failing idempotency, secrecy, and file-mode tests**

Run the seed twice against PostgreSQL and a temporary output directory. Assert
fixed row counts, stable IDs, no duplicate ledger rows, no token in captured
logs, and credential mode `0600`:

```ts
expect(second).toEqual(first);
expect(counts).toEqual({
  households: 1,
  children: 2,
  parents: 1,
  dashboards: 1,
  templates: 8,
  availableChores: 4,
  ledgerTransactions: 2,
});
const parentCredential = JSON.parse(
  await readFile(first.parentCredentialPath, 'utf8'),
);
const dashboardCredential = JSON.parse(
  await readFile(first.dashboardCredentialPath, 'utf8'),
);
expect(capturedOutput).not.toContain(parentCredential.accessToken);
expect(capturedOutput).not.toContain(dashboardCredential.accessToken);
expect((await stat(first.parentCredentialPath)).mode & 0o777).toBe(0o600);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @family/api exec vitest run test/dev-seed.test.ts
```

Expected: FAIL because the seed module does not exist.

- [ ] **Step 3: Implement deterministic fixture records**

Use fixed UUIDs in the `00000000-0000-4000-8000-0000000001xx` range, reserved
only for this development household. In one transaction, delete only that exact
household ID and recreate `Example Family`, America/New_York, Avery, Riley, one
parent, one kitchen dashboard, eight templates, four available instances, and
one manual credit for each child. This makes every run a clean refresh while
never targeting user-created households.

The function must throw when `NODE_ENV === 'production'`.

- [ ] **Step 4: Write credentials atomically without logging secrets**

Create the output directory with `0700`. Write a temporary file with `0600`,
`fsync`, and rename it to `parent.json` or `dashboard.json`. Each file contains
only version, normalized API origin, and signed access token. Normal stdout is:

```text
Development household refreshed.
Household: 00000000-0000-4000-8000-000000000101
Parent credential: .local/dev-fixtures/parent.json
Dashboard credential: .local/dev-fixtures/dashboard.json
```

Add `.local/` to `.gitignore`.

- [ ] **Step 5: Add the guarded command**

`scripts/dev-seed.sh` validates `DATABASE_URL`, `DEVELOPMENT_AUTH_SECRET`,
`DEV_PARENT_API_ORIGIN`, and `DEV_DASHBOARD_API_ORIGIN`, builds contracts and
API, and runs `dist/dev/seed-cli.js`. The separate origins let a phone reach the
API directly while Chromium uses the dashboard's same-origin Vite/Caddy proxy.
Expose it as root `pnpm dev:seed`. Do not start or stop the database implicitly.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @family/api exec vitest run test/dev-seed.test.ts
pnpm --filter @family/api build
pnpm typecheck
git diff --check
```

Commit:

```bash
git add .gitignore package.json apps/api scripts/dev-seed.sh
git commit -m "feat: seed the local family experience"
```

---

### Task 6: Expo Parent Shell, Session, and Persisted Reads

**Files:**

- Create: `apps/parent/package.json`
- Create: `apps/parent/app.config.ts`
- Create: `apps/parent/tsconfig.json`
- Create: `apps/parent/jest.config.cjs`
- Create: `apps/parent/jest.setup.ts`
- Create: `apps/parent/app/_layout.tsx`
- Create: `apps/parent/app/index.tsx`
- Create: `apps/parent/app/setup.tsx`
- Create: `apps/parent/app/(tabs)/_layout.tsx`
- Create: `apps/parent/app/(tabs)/home.tsx`
- Create: `apps/parent/src/app/app-provider.tsx`
- Create: `apps/parent/src/auth/session-store.ts`
- Create: `apps/parent/src/auth/use-session.ts`
- Create: `apps/parent/src/query/create-query-client.ts`
- Create: `apps/parent/src/query/parent-snapshot.ts`
- Create: `apps/parent/src/screens/setup-screen.tsx`
- Create: `apps/parent/src/screens/home-screen.tsx`
- Create: `apps/parent/src/components/child-summary-card.tsx`
- Create: `apps/parent/src/components/connection-status.tsx`
- Create: `apps/parent/src/components/screen-state.tsx`
- Create: `apps/parent/test/session-store.test.ts`
- Create: `apps/parent/test/setup-screen.test.tsx`
- Create: `apps/parent/test/home-screen.test.tsx`
- Modify: `vitest.config.mts`
- Modify: `package.json`
- Modify: `eslint.config.mjs`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

```ts
export interface ParentSessionStore {
  load(): Promise<ClientSession | undefined>;
  save(session: ClientSession): Promise<void>;
  clear(): Promise<void>;
}

export type ParentAppDependencies = {
  sessionStore: ParentSessionStore;
  secureStore: Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>;
  asyncStorage: AsyncStorageStatic;
  fetch: typeof globalThis.fetch;
};
```

- [ ] **Step 1: Write failing session, setup, and home tests**

Use an in-memory secure-store adapter and real `createFamilyApiClient` with a
fake fetch boundary. Prove setup rejects dashboard credentials, saves a parent
session, clears the prior query cache on actor change, and renders Avery/Riley
balances from `ParentSnapshotSchema`.

- [ ] **Step 2: Run Jest and confirm RED**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand
```

Expected: FAIL because the Expo application does not exist.

- [ ] **Step 3: Scaffold the pinned Expo 57 application**

Create a private workspace package with `main: "expo-router/entry"`. Pin Expo
`57.0.11`, React `19.2.3`, React Native `0.86.2`, and Expo Router `57.0.7`.
Install SDK-native dependencies through Expo's compatibility resolver:

```bash
pnpm add --filter @family/parent --save-exact expo@57.0.11 expo-router@57.0.7 react@19.2.3 react-native@0.86.2
pnpm --filter @family/parent exec expo install expo-secure-store expo-status-bar expo-linking expo-constants react-native-safe-area-context react-native-screens @react-native-async-storage/async-storage @react-native-community/netinfo
pnpm add --filter @family/parent --save-exact '@family/api-client@workspace:*' '@family/contracts@workspace:*' '@family/chore-images@workspace:*' '@family/design-tokens@workspace:*' @tanstack/react-query@5.100.14 @tanstack/react-query-persist-client@5.100.14 @tanstack/query-async-storage-persister@5.100.14
pnpm --filter @family/parent exec expo install jest-expo jest @types/jest @testing-library/react-native @types/react -- --dev
```

Use Expo Router typed routes and scheme `family-app`. Keep the New Architecture
enabled as required by React Native 0.86.

- [ ] **Step 4: Implement secure session and persisted-query ownership**

Store the token only through SecureStore. Store non-secret origin and actor
metadata alongside it. Query persistence uses AsyncStorage and a buster derived
from `${apiOrigin}:${householdId}:${actorId}:${role}`. On session change, remove
the old persisted client before creating the new `QueryClient`. Configure
dehydration to include only parent-snapshot and child-ledger query keys and set
`shouldDehydrateMutation: () => false`; no mutation or form draft is queued.
Connect TanStack's online and focus managers to NetInfo and React Native
`AppState`.

- [ ] **Step 5: Implement development setup and home shell**

The setup screen accepts credential JSON pasted from `.local/dev-fixtures`,
parses it through `parseDevelopmentCredential`, requires role `PARENT`, saves it,
and replaces navigation with `/(tabs)/home`. Give the credential control the
marker `family-app-development-credential-import` for production bundle tests.

In `app/setup.tsx`, load the development setup module only inside a compile-time
`__DEV__` branch. The production branch renders a plain “Production sign-in is
not configured” screen and contains neither development marker. The final
bundle gate, not source inspection alone, proves Metro removed the development
branch.

Home renders last valid data during refresh, pull-to-refresh, offline/stale time,
Avery/Riley cards, active chore labels, and pending count. It does not render
calendar or push placeholders.

- [ ] **Step 6: Integrate Jest without duplicate Vitest discovery**

Change the root Vitest configuration to list only projects that exist at this
stage, so Jest tests under `apps/parent` are not collected by Vitest:

```ts
export default defineConfig({
  test: {
    projects: ['apps/api/vitest.config.ts', 'packages/*'],
  },
});
```

Task 9 will add the dashboard project after its configuration exists. Extend
root `pnpm test` with
`pnpm --filter @family/parent test -- --runInBand`. Add explicit browser, React
Native, and `__DEV__` globals to the flat ESLint configuration.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand
pnpm --filter @family/parent typecheck
pnpm --filter @family/parent exec expo export --platform ios --output-dir dist/ios
pnpm --filter @family/parent exec expo export --platform android --output-dir dist/android
pnpm lint
```

Commit:

```bash
git add apps/parent package.json vitest.config.mts eslint.config.mjs pnpm-lock.yaml
git commit -m "feat: add parent mobile foundation"
```

---

### Task 7: Parent Home and Approval Inbox

**Files:**

- Create: `apps/parent/app/(tabs)/approvals.tsx`
- Create: `apps/parent/app/approval/[submissionAttemptId].tsx`
- Create: `apps/parent/src/screens/approvals-screen.tsx`
- Create: `apps/parent/src/screens/approval-detail-screen.tsx`
- Create: `apps/parent/src/features/approvals/use-approval-operation.ts`
- Create: `apps/parent/src/components/approval-card.tsx`
- Create: `apps/parent/src/components/money-input.tsx`
- Modify: `apps/parent/src/screens/home-screen.tsx`
- Create: `apps/parent/test/approvals-screen.test.tsx`
- Create: `apps/parent/test/approval-detail-screen.test.tsx`
- Modify: `apps/parent/test/home-screen.test.tsx`

**Interfaces:**

```ts
export type ApprovalDraft = {
  submissionAttemptId: string;
  choreInstanceId: string;
  payoutInput: string;
  note: string;
  rejectionReason: string;
};

export interface ApprovalOperation {
  approve(draft: ApprovalDraft): Promise<ChoreDecisionResult>;
  reject(draft: ApprovalDraft, retry: boolean): Promise<ChoreDecisionResult>;
  cancel(): void;
}
```

- [ ] **Step 1: Write failing oldest-first and decision tests**

Render two pending submissions out of order and assert the oldest appears first.
Exercise adjusted approval, retry rejection, close rejection, and a concurrent
winning decision. Assert the same UUID is used after a simulated network failure
and the form remains populated until confirmed.

- [ ] **Step 2: Run focused Jest tests and confirm RED**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand approvals-screen approval-detail-screen home-screen
```

Expected: FAIL because approval routes and components do not exist.

- [ ] **Step 3: Implement the inbox and detail route**

Render picture, child, submitted time, proposed value, and elapsed completion
time as `submittedAt - claimedAt` when `claimedAt` is present; omit that label
when it is `null`. This remains correct after parent extensions and retry
rejections. Use `submissionAttemptId` as the route key. Provide accessible names
such as `Review Tidy toys for Avery`.

Set parent-snapshot polling to fifteen seconds only when the app's `AppState` is
active and the current inbox is nonempty. Disable the interval otherwise and
invalidate once when the app returns to the foreground.

- [ ] **Step 4: Implement one retained operation key per decision draft**

Generate the UUID when the detail screen creates a draft, not when the button is
pressed. Approve uses `parseUnsignedDollars`; reject sends `retry: true` or
`false`. On success, replace the draft with the immutable server result and
invalidate the parent snapshot and affected ledger. On conflict, render the
returned winning decision rather than the requested decision label.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand approvals-screen approval-detail-screen home-screen
pnpm --filter @family/parent typecheck
pnpm lint
```

Commit:

```bash
git add apps/parent
git commit -m "feat: add parent approval inbox"
```

---

### Task 8: Parent Chore Library and Rewards

**Files:**

- Create: `apps/parent/app/(tabs)/chores.tsx`
- Create: `apps/parent/app/(tabs)/rewards.tsx`
- Create: `apps/parent/src/screens/chores-screen.tsx`
- Create: `apps/parent/src/screens/rewards-screen.tsx`
- Create: `apps/parent/src/features/chores/template-form.tsx`
- Create: `apps/parent/src/features/chores/publish-form.tsx`
- Create: `apps/parent/src/features/rewards/ledger-entry-form.tsx`
- Create: `apps/parent/src/components/chore-image-picker.tsx`
- Create: `apps/parent/src/components/chore-image.tsx`
- Create: `apps/parent/src/components/ledger-row.tsx`
- Create: `apps/parent/test/chores-screen.test.tsx`
- Create: `apps/parent/test/rewards-screen.test.tsx`

**Interfaces:**

```ts
export type TemplateDraft = {
  name: string;
  imageKey: ChoreImageKey;
  instructions: string;
  valueInput: string;
  durationMinutesInput: string;
};

export type LedgerEntryDraft = {
  childId: string;
  kind: 'PURCHASE' | 'MANUAL_CREDIT' | 'CORRECTION';
  amountInput: string;
  note: string;
};
```

- [ ] **Step 1: Write failing pictured-template, publish, and ledger tests**

Test every built-in picture has an accessible label, template dollars become
exact cents, publishing accepts defaults or overrides, purchases negate positive
input, manual credits remain positive, corrections require an explicit sign,
and every manual entry requires a note. Simulate an offline response and prove
input and idempotency key remain unchanged.

- [ ] **Step 2: Run focused Jest tests and confirm RED**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand chores-screen rewards-screen
```

Expected: FAIL because the screens and forms do not exist.

- [ ] **Step 3: Implement chore template and publish workflows**

Create templates through `CreateChoreTemplateSchema`; reject blank text,
fractional cents, and duration outside `1..1440`. After creation, refresh the
snapshot and keep the new template selected for publishing. Publish sends one
new operation key and optional exact overrides.

- [ ] **Step 4: Implement rewards and immutable ledger rows**

Load ledger details only after a parent selects a child. Display aggregate
balance and reverse-chronological transactions. Convert positive purchase input
to negative cents, preserve signed correction input, and send the household ID
from the authenticated snapshot. Clear the form only after a `201` response.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand chores-screen rewards-screen
pnpm --filter @family/parent typecheck
pnpm lint
```

Commit:

```bash
git add apps/parent
git commit -m "feat: manage chores and rewards from phones"
```

---

### Task 9: Dashboard PWA Shell and Offline-Safe Snapshot Cache

**Files:**

- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/tsconfig.app.json`
- Create: `apps/dashboard/vite.config.ts`
- Create: `apps/dashboard/vitest.config.ts`
- Create: `apps/dashboard/index.html`
- Create: `apps/dashboard/public/icons/family-kitchen-192.png`
- Create: `apps/dashboard/public/icons/family-kitchen-512.png`
- Create: `apps/dashboard/src/main.tsx`
- Create: `apps/dashboard/src/app.tsx`
- Create: `apps/dashboard/src/styles.css`
- Create: `apps/dashboard/src/auth/dashboard-session.ts`
- Create: `apps/dashboard/src/query/dashboard-query.ts`
- Create: `apps/dashboard/src/query/indexed-db-storage.ts`
- Create: `apps/dashboard/src/screens/setup-screen.tsx`
- Create: `apps/dashboard/src/screens/family-home-screen.tsx`
- Create: `apps/dashboard/src/components/connection-status.tsx`
- Create: `apps/dashboard/src/components/child-card.tsx`
- Create: `apps/dashboard/test/setup-screen.test.tsx`
- Create: `apps/dashboard/test/family-home-screen.test.tsx`
- Create: `apps/dashboard/test/pwa-config.test.ts`
- Modify: `vitest.config.mts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

```ts
export interface DashboardSessionStore {
  load(): Promise<ClientSession | undefined>;
  save(session: ClientSession): Promise<void>;
  clear(): Promise<void>;
}

export interface AsyncKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing setup, home, target-size, and PWA tests**

Test dashboard credentials are accepted and parent credentials rejected. Render
a cached snapshot while fetch is offline and assert the stale time remains
visible. Assert primary action styles resolve to `min-height: 64px` and
`min-width: 64px`. Inspect the Vite PWA manifest for standalone landscape mode,
name `Family Kitchen`, and declared 192/512 icons.

- [ ] **Step 2: Run dashboard tests and confirm RED**

Run:

```bash
pnpm --filter @family/dashboard test
```

Expected: FAIL because the dashboard package does not exist.

- [ ] **Step 3: Scaffold pinned Vite and PWA dependencies**

Install:

```bash
pnpm add --filter @family/dashboard --save-exact react@19.2.3 react-dom@19.2.3 '@family/api-client@workspace:*' '@family/contracts@workspace:*' '@family/chore-images@workspace:*' '@family/design-tokens@workspace:*' @tanstack/react-query@5.100.14 @tanstack/react-query-persist-client@5.100.14 @tanstack/query-async-storage-persister@5.100.14 idb-keyval@6.2.2
pnpm add --filter @family/dashboard --save-dev --save-exact vite@8.0.16 @vitejs/plugin-react@6.0.4 vite-plugin-pwa@1.3.0 @types/react@latest @types/react-dom@latest @testing-library/react@latest @testing-library/jest-dom@latest jsdom@latest
```

Configure Vite's development `/v1` and `/health` proxies to
`http://127.0.0.1:3000` and use the dashboard origin as `apiOrigin` in browser
development. This keeps authenticated browser calls same-origin.

Now that `apps/dashboard/vitest.config.ts` exists, update the root projects to:

```ts
projects: [
  'apps/api/vitest.config.ts',
  'apps/dashboard/vitest.config.ts',
  'packages/*',
];
```

- [ ] **Step 4: Implement session partitioning and IndexedDB persistence**

Wrap `idb-keyval` behind `AsyncKeyValueStore`. Use the same actor/origin cache
buster as the parent app. Clear old IndexedDB data before saving a new dashboard
session. Mark fixture setup with
`family-app-development-credential-import` for production bundle inspection.
Persist only dashboard-snapshot query keys with
`shouldDehydrateMutation: () => false`. Gate the setup module behind
`import.meta.env.DEV` so Rollup can remove both development markers; production
renders a local-deployment-not-configured screen instead.

- [ ] **Step 5: Implement the family home shell**

Render local clock, connection status with text and symbol, Avery/Riley cards,
balance, current chore label, pool count, and a dominant Chore Board button.
When cached data exists, never replace it with a blank loading screen. Show
`Last updated <time>` during offline/reconnecting states.

- [ ] **Step 6: Configure installable application-shell caching**

Use `VitePWA({ registerType: 'prompt' })`. Precache HTML, JS, CSS, icons, and all
eight chore images. Do not runtime-cache authenticated API responses in the
service worker; TanStack's actor-partitioned IndexedDB cache owns safe-read data.
Derive the two PWA icons from the existing chore illustration style, verify their
exact `192x192` and `512x512` dimensions with `file`, and declare both in the
manifest rather than introducing another visual system.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm --filter @family/dashboard test
pnpm --filter @family/dashboard typecheck
pnpm --filter @family/dashboard build
pnpm lint
```

Commit:

```bash
git add apps/dashboard pnpm-lock.yaml
git commit -m "feat: add offline-ready kitchen dashboard"
```

---

### Task 10: Dashboard Chore Board, Claim, Countdown, and Submission

**Files:**

- Create: `apps/dashboard/src/screens/chore-board-screen.tsx`
- Create: `apps/dashboard/src/screens/chore-detail-screen.tsx`
- Create: `apps/dashboard/src/screens/active-chore-screen.tsx`
- Create: `apps/dashboard/src/features/chores/use-chore-operation.ts`
- Create: `apps/dashboard/src/features/chores/countdown.ts`
- Create: `apps/dashboard/src/components/chore-tile.tsx`
- Create: `apps/dashboard/src/components/chore-picture.tsx`
- Create: `apps/dashboard/src/components/child-picker.tsx`
- Create: `apps/dashboard/src/components/confirm-action.tsx`
- Modify: `apps/dashboard/src/app.tsx`
- Modify: `apps/dashboard/src/screens/family-home-screen.tsx`
- Create: `apps/dashboard/test/chore-board-screen.test.tsx`
- Create: `apps/dashboard/test/chore-detail-screen.test.tsx`
- Create: `apps/dashboard/test/active-chore-screen.test.tsx`
- Create: `apps/dashboard/test/countdown.test.ts`

**Interfaces:**

```ts
export function estimateServerOffsetMs(
  serverTime: string,
  clientReceivedAtMs: number,
): number;

export function remainingSeconds(
  deadline: string,
  clientNowMs: number,
  serverOffsetMs: number,
): number;

export interface ChoreOperation<TInput, TResult> {
  idempotencyKey: string;
  execute(input: TInput): Promise<TResult>;
  cancel(): void;
}
```

- [ ] **Step 1: Write failing board, conflict, countdown, and submission tests**

Test picture/value/time tiles, four-step claim flow, offline disabling, the
literal claim-conflict message, retained key on retry, child ownership, exact
deadline equality returning zero, submit confirmation, and waiting state.

Countdown literals:

```ts
expect(estimateServerOffsetMs('2026-08-09T12:00:00.000Z', noonPlus250)).toBe(-250);
expect(remainingSeconds('2026-08-09T12:05:00.000Z', noonPlus250, -250)).toBe(300);
expect(remainingSeconds('2026-08-09T12:05:00.000Z', fivePastPlus250, -250)).toBe(0);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
pnpm --filter @family/dashboard test -- chore-board-screen chore-detail-screen active-chore-screen countdown
```

Expected: FAIL because the workflow screens do not exist.

- [ ] **Step 3: Implement board and claim flow**

Sort available chores by `createdAt, id`. The detail screen shows picture,
instructions, value, and time. Child selection requires a separate confirmation
step. Generate the operation UUID when confirmation first opens, preserve it
across retry, and discard it after success or explicit cancellation.

Map `CHORE_UNAVAILABLE` to exactly “That chore was just claimed.”, refresh the
snapshot, and return to the board. Disable the confirm control whenever
`navigator.onLine` is false or query connectivity is paused.

- [ ] **Step 4: Implement active countdown without local expiration**

Compute offset from each successful snapshot. Clamp visible remaining seconds
to zero. Reaching zero changes only the label to “Checking with the family
server…” and invalidates the dashboard snapshot; it never edits cached chore
status.

- [ ] **Step 5: Implement submit and waiting state**

Only the child who owns the claim sees **I'm done**. Require a second tap in
`ConfirmAction`, submit with a retained UUID, then show “Waiting for a grown-up.”
Invalidate immediately and poll at five seconds while any chore is claimed or
awaiting approval; otherwise poll every thirty seconds. Pause when hidden.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm --filter @family/dashboard test
pnpm --filter @family/dashboard typecheck
pnpm --filter @family/dashboard build
pnpm lint
```

Commit:

```bash
git add apps/dashboard
git commit -m "feat: complete dashboard chore workflow"
```

---

### Task 11: Full-Stack Browser Flow, Production-Bundle Guard, and Handoff

**Files:**

- Create: `playwright.config.ts`
- Create: `e2e/dashboard-chore-flow.spec.ts`
- Create: `scripts/e2e-prepare.sh`
- Create: `scripts/verify-production-bundles.sh`
- Create: `scripts/verify-no-credential-leaks.mjs`
- Create: `docs/development/client-vertical-slice.md`
- Modify: `package.json`
- Modify: `apps/api/README.md`
- Modify: `.gitignore`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Root `pnpm test:e2e` prepares the fixed development household, starts API and
  dashboard through Playwright `webServer`, and runs one real browser journey.
- Root `pnpm verify:production-bundles` exports parent iOS/Android bundles and
  dashboard PWA with fixture auth disabled, then proves the development marker
  and fixture token shape are absent.

- [ ] **Step 1: Write the failing full-stack Playwright journey**

The browser test must:

1. Import `.local/dev-fixtures/dashboard.json` through the setup screen.
2. Open Chore Board and claim `Tidy toys` as Avery.
3. Submit it and see `Waiting for a grown-up`.
4. Use the real shared API client with `.local/dev-fixtures/parent.json` to
   approve the exact pending attempt for `$3.00`.
5. Poll the dashboard and assert Avery's displayed balance increases exactly
   once.
6. Fetch Avery's parent ledger and assert one linked `CHORE_CREDIT` for the
   approved attempt.

- [ ] **Step 2: Run Playwright and confirm RED**

Run:

```bash
pnpm test:e2e
```

Expected: FAIL because orchestration, configuration, and the journey do not
exist.

- [ ] **Step 3: Implement deterministic E2E preparation and web servers**

Install the pinned Playwright test runner and its Chromium binary:

```bash
pnpm add --save-dev --save-exact @playwright/test@1.62.0
pnpm exec playwright install chromium
```

`scripts/e2e-prepare.sh` starts the named local PostgreSQL container, applies
migrations, builds the API, and runs `pnpm dev:seed` with parent/dashboard API
origins both set to `http://127.0.0.1:5173`; it never deletes the named volume.
It generates a fresh test-only signing secret, uses `umask 077`, and writes the
database URL, secret, and both origins to ignored
`.local/e2e-runtime.json` without printing their values. The credential files
are issued with that same secret.

`playwright.config.ts` reads `.local/e2e-runtime.json` during configuration and
passes its values through `webServer[].env` to the API and dashboard processes.
This is required because environment exports inside the preparation subprocess
cannot mutate the parent shell. Fail with a clear setup error when the runtime
file is absent or malformed. Playwright starts these two processes and waits for
their URLs:

```ts
webServer: [
  {
    command: 'pnpm --filter @family/api start',
    url: 'http://127.0.0.1:3000/health/ready',
    reuseExistingServer: false,
  },
  {
    command: 'pnpm --filter @family/dashboard dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
  },
],
```

Pass `DATABASE_URL`, `DEVELOPMENT_AUTH_SECRET`,
`DEV_PARENT_API_ORIGIN=http://127.0.0.1:5173`, and
`DEV_DASHBOARD_API_ORIGIN=http://127.0.0.1:5173` from that runtime object. Never
print secret values.

Set the root script exactly to:

```json
{
  "test:e2e": "./scripts/e2e-prepare.sh && playwright test"
}
```

- [ ] **Step 4: Add the production-bundle safety regression**

Build with fixture flags disabled and fail if output contains either
`family-app-development-credential-import` or a fixture-token decoder marker:

```bash
if rg -n 'family-app-development-credential-import|development-fixture-token-claims' \
  apps/parent/dist apps/dashboard/dist; then
  echo 'Development credential code leaked into a production bundle.' >&2
  exit 1
fi
```

`scripts/verify-no-credential-leaks.mjs` must read both generated credential
files, obtain tracked paths from `git ls-files -z`, and scan file contents in
process. It exits nonzero with only the offending path when a token is found;
it never prints or interpolates either token into a shell command. Invoke it at
the end of `verify:production-bundles` so the gate also proves no tracked file
contains either generated access token.

- [ ] **Step 5: Document exact local run and Raspberry Pi preview commands**

Document database start, migration, seed, API start, Expo start, dashboard dev,
dashboard preview, credential import, test commands, and safe database stop.
State prominently that this milestone is LAN/local-development only and is not
approved for public ingress.

- [ ] **Step 6: Run the full repository gate**

Run fresh commands on the exact final head:

```bash
DOCKER_HOST=unix://${FAMILY_APP_USER_HOME}/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm format:check
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
pnpm test:e2e
pnpm verify:production-bundles
git diff --check
```

Expected: all unit, PostgreSQL integration, Jest Expo, dashboard component,
production-bundle, and Playwright checks pass with zero failures.

- [ ] **Step 7: Commit the verified vertical slice**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts e2e scripts docs apps/api/README.md .gitignore
git commit -m "test: verify the family client vertical slice"
```

---

## Official Compatibility References

- Expo SDK 57 compatibility table and supported React Native/React versions:
  <https://docs.expo.dev/versions/latest/>
- Expo Router 57 installation and compatible native modules:
  <https://docs.expo.dev/router/installation/>
- Vite 8 release and Node requirements: <https://vite.dev/guide/> and
  <https://github.com/vitejs/vite/releases>
- TanStack Query React and React Native compatibility:
  <https://tanstack.com/query/latest/docs/framework/react/installation>
- Vite PWA/Workbox integration: <https://github.com/vite-pwa/vite-plugin-pwa>
- Playwright releases and browser compatibility:
  <https://github.com/microsoft/playwright/releases>

## Completion Definition

Do not call this milestone complete until all eleven tasks are committed, every
task's focused RED/GREEN evidence is recorded during execution, the exact final
head passes the full repository gate, and a final review confirms the dashboard
wire payload exposes no parent-only or transaction-level data.
