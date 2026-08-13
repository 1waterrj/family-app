# Core Chores and Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable, server-authoritative API that supports households, child profiles, a shared chore pool, atomic claiming, timed completion, parent approval, and an immutable dollar ledger.

**Architecture:** Use a pnpm TypeScript workspace with a Fastify API, focused domain packages, Drizzle-managed PostgreSQL, and Vitest integration tests against a real PostgreSQL container. HTTP handlers authenticate a request into an explicit `ActorContext`; application services enforce household and role permissions and own all state transitions. This plan builds the core service boundary consumed later by the parent mobile app and Raspberry Pi dashboard.

**Tech Stack:** Node.js 24 LTS, pnpm 11, TypeScript, Fastify, Zod, PostgreSQL 17, Drizzle ORM/Kit, `postgres` driver, Vitest, Testcontainers, ESLint, Prettier

## Global Constraints

- Store money as integer cents; never use floating-point values for balances or payouts.
- Store timestamps in UTC and accept a household IANA time-zone identifier.
- Every household-owned row includes `household_id`; every application query is household-scoped.
- Children are profiles, not authenticated users.
- Parents have equal permissions; dashboard devices have a restricted role.
- The server is authoritative for chore state, deadlines, final payouts, and permissions.
- Ledger transactions are append-only; corrections are compensating entries.
- Approval and ledger credit occur in one database transaction and are idempotent.
- Do not expose PostgreSQL or administrative services through the application API.
- Use exact dependency versions written to `pnpm-lock.yaml`; do not use unbounded `latest` tags in deployment files.
- This plan does not implement Google authentication, push delivery, mobile UI, kiosk UI, calendar sync, savings goals, celebrations, Cloudflare, or Home Assistant; those are separate plans using the interfaces defined here.

## Plan Series

This is plan 1 of the approved design. Follow-up plans are:

1. Parent mobile authentication, approval inbox, and push notifications
2. Raspberry Pi dashboard and offline kiosk behavior
3. Google Calendar authorization, synchronization, and agenda UI
4. Savings goals, celebration packs, and parent thank-you notes
5. Ubuntu deployment, Caddy, Cloudflare Tunnel, backups, and monitoring
6. Home Assistant webhooks and operational hardening

## File Map

```text
.
├── apps/
│   └── api/
│       ├── src/
│       │   ├── app.ts                 # Fastify composition root
│       │   ├── config.ts              # Validated runtime configuration
│       │   ├── server.ts              # Process startup and shutdown
│       │   ├── auth/actor-context.ts  # Actor types and request authentication adapter
│       │   ├── db/client.ts           # PostgreSQL client and Drizzle instance
│       │   ├── db/schema.ts           # Core relational schema and enums
│       │   ├── db/transaction.ts      # Transaction boundary type
│       │   ├── chores/repository.ts   # Household-scoped chore persistence
│       │   ├── chores/service.ts      # Chore commands and authorization
│       │   ├── chores/routes.ts       # HTTP chore endpoints
│       │   ├── households/routes.ts   # Household and child-profile endpoints
│       │   ├── ledger/repository.ts   # Append-only ledger persistence
│       │   ├── ledger/service.ts      # Balance reads and manual entries
│       │   ├── ledger/routes.ts       # HTTP reward endpoints
│       │   └── workers/expire.ts      # Idempotent chore-expiration worker
│       └── test/
│           ├── support/database.ts    # PostgreSQL test container lifecycle
│           ├── support/fixtures.ts    # Household, actor, child, and chore fixtures
│           ├── schema.test.ts
│           ├── chores.test.ts
│           ├── approvals.test.ts
│           ├── ledger.test.ts
│           └── api.test.ts
├── packages/
│   └── contracts/
│       ├── src/index.ts               # Public contract exports
│       ├── src/common.ts              # IDs, cents, timestamps, errors
│       ├── src/chores.ts              # Chore commands and views
│       ├── src/households.ts           # Household and child contracts
│       ├── src/ledger.ts               # Ledger commands and views
│       └── test/contracts.test.ts
├── db/
│   └── migrations/                    # Generated, committed SQL migrations
├── scripts/
│   └── dev-db.sh                      # Explicit local PostgreSQL container commands
├── .env.example
├── .editorconfig
├── eslint.config.mjs
├── package.json
├── pnpm-workspace.yaml
├── prettier.config.mjs
├── tsconfig.base.json
└── vitest.workspace.ts
```

---

### Task 1: Workspace and Contract Foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `.editorconfig`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `vitest.workspace.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/households.ts`
- Create: `packages/contracts/src/chores.ts`
- Create: `packages/contracts/src/ledger.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Consumes: Approved design terminology and state machine.
- Produces: `ActorRole`, branded identifier schemas, `MoneyCentsSchema`, `ChoreStatusSchema`, request schemas, response schemas, and `ApiErrorSchema` exported by `@family/contracts`.

- [ ] **Step 1: Create the workspace manifests and install pinned dependencies**

Create the root package with private workspaces and scripts:

```json
{
  "name": "family-app",
  "private": true,
  "packageManager": "pnpm@11.16.0",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "lint": "eslint .",
    "format:check": "prettier --check ."
  }
}
```

Create `pnpm-workspace.yaml` with `apps/*` and `packages/*`, then install exact versions with:

```bash
pnpm add -Dw --save-exact typescript eslint @eslint/js typescript-eslint prettier vitest
pnpm add --filter @family/contracts --save-exact zod
```

- [ ] **Step 2: Write failing contract tests**

Test concrete invariants:

```ts
import { describe, expect, it } from 'vitest';
import { ChoreStatusSchema, MoneyCentsSchema, SubmitChoreSchema } from '../src/index.js';

describe('core contracts', () => {
  it('accepts integer cents and rejects fractions', () => {
    expect(MoneyCentsSchema.parse(1250)).toBe(1250);
    expect(() => MoneyCentsSchema.parse(12.5)).toThrow();
  });

  it('uses only approved chore states', () => {
    expect(ChoreStatusSchema.options).toEqual([
      'AVAILABLE', 'CLAIMED', 'AWAITING_APPROVAL', 'APPROVED', 'CLOSED'
    ]);
  });

  it('requires an idempotency key for submission', () => {
    expect(() => SubmitChoreSchema.parse({ choreInstanceId: crypto.randomUUID() })).toThrow();
  });
});
```

- [ ] **Step 3: Run the contract test and verify failure**

Run: `pnpm vitest run packages/contracts/test/contracts.test.ts`  
Expected: FAIL because contract exports do not exist.

- [ ] **Step 4: Implement focused Zod contracts**

Define branded UUID schemas for `HouseholdId`, `ChildId`, `ChoreTemplateId`, `ChoreInstanceId`, `ParentId`, and `DashboardDeviceId`. Define:

```ts
export const MoneyCentsSchema = z.number().int().safe();
export const ActorRoleSchema = z.enum(['PARENT', 'DASHBOARD']);
export const ChoreStatusSchema = z.enum([
  'AVAILABLE', 'CLAIMED', 'AWAITING_APPROVAL', 'APPROVED', 'CLOSED'
]);
export const SubmitChoreSchema = z.object({
  choreInstanceId: ChoreInstanceIdSchema,
  idempotencyKey: z.string().uuid(),
});
```

Add complete schemas for create-household, create-child, create-template, publish-instance, claim, submit, extend, cancel, approve, reject, manual-ledger-entry, chore views, ledger views, and structured API errors. Export inferred TypeScript types with the same base name minus `Schema`.

- [ ] **Step 5: Run workspace quality checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`  
Expected: all commands exit 0.

- [ ] **Step 6: Commit the foundation**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs prettier.config.mjs .editorconfig .env.example vitest.workspace.ts packages/contracts .gitignore
git commit -m "chore: establish TypeScript workspace and contracts"
```

---

### Task 2: PostgreSQL Schema and Test Harness

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/transaction.ts`
- Create: `apps/api/test/support/database.ts`
- Create: `apps/api/test/schema.test.ts`
- Create: `scripts/dev-db.sh`
- Create: `db/migrations/0000_core.sql`

**Interfaces:**
- Consumes: Identifier and state schemas from `@family/contracts`.
- Produces: `Database`, `DatabaseTransaction`, `createDatabase(connectionString)`, and typed Drizzle tables used by every service.

- [ ] **Step 1: Add API database dependencies**

```bash
pnpm add --filter @family/api --save-exact fastify zod drizzle-orm postgres @family/contracts@workspace:*
pnpm add --filter @family/api -D --save-exact drizzle-kit testcontainers @testcontainers/postgresql
```

- [ ] **Step 2: Write a failing schema integration test**

Start a PostgreSQL 17 Testcontainer, apply migrations, insert two households, and assert:

```ts
it('rejects duplicate idempotency keys within one household', async () => {
  await insertApproval({ householdId, idempotencyKey, choreInstanceId });
  await expect(insertApproval({ householdId, idempotencyKey, choreInstanceId }))
    .rejects.toThrow(/unique/i);
});

it('allows the same idempotency key in a different household', async () => {
  await insertApproval({ householdId: first, idempotencyKey, choreInstanceId: firstChore });
  await expect(insertApproval({ householdId: second, idempotencyKey, choreInstanceId: secondChore }))
    .resolves.toBeDefined();
});
```

- [ ] **Step 3: Run the schema test and verify failure**

Run: `pnpm --filter @family/api test -- schema.test.ts`  
Expected: FAIL because the schema and migration do not exist.

- [ ] **Step 4: Implement the relational schema**

Create enums and tables for households, parent memberships, child profiles, dashboard devices, chore templates, chore instances, chore transitions, approval decisions, ledger transactions, audit events, and idempotency records.

Required constraints:

```sql
CHECK (default_value_cents >= 0);
CHECK (default_duration_seconds BETWEEN 60 AND 86400);
CHECK (amount_cents <> 0);
UNIQUE (household_id, idempotency_key);
UNIQUE (household_id, chore_instance_id) /* approval decision */;
```

Use composite foreign keys or equivalent database checks so child, template, chore, decision, and ledger references cannot cross household boundaries. Add indexes for `(household_id, status)`, `(household_id, child_id, created_at)`, and expiration scans on claimed chores.

- [ ] **Step 5: Add migration and local database script**

Generate and inspect `db/migrations/0000_core.sql`. `scripts/dev-db.sh` must support `start`, `stop`, and `url`, use the explicit container name `family-app-postgres`, bind only `127.0.0.1:54329`, and use a named volume rather than deleting data.

- [ ] **Step 6: Run schema tests and migration replay**

Run: `pnpm --filter @family/api test -- schema.test.ts`  
Expected: PASS.

Run migrations twice against a fresh disposable test database.  
Expected: first application succeeds; the migration runner reports no pending migrations on the second run.

- [ ] **Step 7: Commit the database foundation**

```bash
git add apps/api db/migrations scripts/dev-db.sh pnpm-lock.yaml
git commit -m "feat: add core PostgreSQL schema"
```

---

### Task 3: Actor Context, Household Isolation, and Fixtures

**Files:**
- Create: `apps/api/src/auth/actor-context.ts`
- Create: `apps/api/src/households/service.ts`
- Create: `apps/api/test/support/fixtures.ts`
- Create: `apps/api/test/authorization.test.ts`

**Interfaces:**
- Consumes: `Database`, household tables, `ActorRole`.
- Produces: `ActorContext`, `requireParent(actor)`, `requireDashboard(actor)`, `assertHousehold(actor, householdId)`, and fixture builders.

- [ ] **Step 1: Write failing authorization tests**

```ts
it('prevents a parent from reading another household', async () => {
  const { parent: firstParent } = await fixtures.household();
  const { child: secondChild } = await fixtures.household();
  await expect(service.getChild(firstParent, secondChild.id)).rejects.toMatchObject({
    code: 'NOT_FOUND'
  });
});

it('prevents a dashboard from making parent mutations', async () => {
  const { dashboard } = await fixtures.household();
  try {
    requireParent(dashboard);
    expect.unreachable('dashboard actor should be rejected');
  } catch (error) {
    expect(error).toMatchObject({ code: 'FORBIDDEN' });
  }
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @family/api test -- authorization.test.ts`  
Expected: FAIL because actor guards and services do not exist.

- [ ] **Step 3: Implement explicit actor context and household services**

```ts
export type ActorContext =
  | { role: 'PARENT'; actorId: string; householdId: string }
  | { role: 'DASHBOARD'; actorId: string; householdId: string };
```

Return `NOT_FOUND`, not `FORBIDDEN`, for identifiers outside the actor's household. Every service method takes `actor` as its first argument. Fixture builders create isolated households and never share child or chore identifiers implicitly.

- [ ] **Step 4: Run authorization and schema tests**

Run: `pnpm --filter @family/api test -- authorization.test.ts schema.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit authorization boundaries**

```bash
git add apps/api/src/auth apps/api/src/households apps/api/test
git commit -m "feat: enforce household actor boundaries"
```

---

### Task 4: Chore Library, Pool, Claim, and Submission

**Files:**
- Create: `apps/api/src/chores/repository.ts`
- Create: `apps/api/src/chores/service.ts`
- Create: `apps/api/test/chores.test.ts`

**Interfaces:**
- Consumes: `ActorContext`, `Database`, chore contracts.
- Produces: `ChoreService.createTemplate`, `publish`, `listAvailable`, `claim`, `submit`, `extend`, and `cancel`.

- [ ] **Step 1: Write failing domain integration tests**

Cover these named cases with real PostgreSQL transactions:

```ts
it('publishes an instance with copied defaults and optional overrides');
it('allows exactly one winner when two children claim concurrently');
it('rejects submission by a child other than the claimant');
it('rejects submission after the server deadline');
it('lets a parent extend or cancel an active claim');
it('prevents a dashboard from creating templates or publishing chores');
```

The concurrency test must issue two `claim` promises after a shared barrier and assert one fulfilled result and one `CHORE_UNAVAILABLE` error.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @family/api test -- chores.test.ts`  
Expected: FAIL because the chore repository and service do not exist.

- [ ] **Step 3: Implement the repository with locked transitions**

Repository methods accept a transaction and household ID. Claim uses one conditional statement or `SELECT ... FOR UPDATE` followed by a guarded update:

```sql
UPDATE chore_instances
SET status = 'CLAIMED', claimed_by_child_id = $child, deadline_at = $deadline
WHERE id = $id AND household_id = $household AND status = 'AVAILABLE'
RETURNING *;
```

Every successful transition inserts a `chore_transitions` row in the same transaction.

- [ ] **Step 4: Implement service rules**

- Parent only: create template, publish, extend, cancel.
- Parent or dashboard: list available.
- Dashboard only: claim and submit on behalf of a child profile in the same household.
- Derive deadlines from an injected `Clock` interface: `{ now(): Date }`.
- Validate all state against the current database row, not request fields.
- Preserve template history by copying name, image key, instructions, value, and duration onto each published instance.

- [ ] **Step 5: Run chore and authorization tests**

Run: `pnpm --filter @family/api test -- chores.test.ts authorization.test.ts`  
Expected: PASS, including the concurrent claim test over repeated runs.

- [ ] **Step 6: Commit core chore transitions**

```bash
git add apps/api/src/chores apps/api/test/chores.test.ts
git commit -m "feat: add shared chore pool lifecycle"
```

---

### Task 5: Immutable Ledger and Manual Adjustments

**Files:**
- Create: `apps/api/src/ledger/repository.ts`
- Create: `apps/api/src/ledger/service.ts`
- Create: `apps/api/test/ledger.test.ts`

**Interfaces:**
- Consumes: `ActorContext`, ledger tables, `MoneyCents`.
- Produces: `LedgerService.getBalance`, `listTransactions`, and `recordManualEntry`.

- [ ] **Step 1: Write failing ledger tests**

```ts
it('calculates balance as the sum of signed integer cents', async () => {
  await ledger.recordManualEntry(parent, { childId, amountCents: 500, note: 'Opening credit' });
  await ledger.recordManualEntry(parent, { childId, amountCents: -225, note: 'Book purchase' });
  expect(await ledger.getBalance(parent, childId)).toEqual({ balanceCents: 275 });
});

it('requires a nonblank note for manual entries');
it('prevents dashboards from writing ledger entries');
it('has no update or delete operation for posted transactions');
it('isolates ledger reads by household');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @family/api test -- ledger.test.ts`  
Expected: FAIL because ledger services do not exist.

- [ ] **Step 3: Implement append-only persistence**

Expose insertion and read methods only. Store signed `amount_cents`, type, actor, note, related chore decision, and timestamp. Use `SUM(amount_cents)::bigint` and convert safely to a JavaScript integer after checking `Number.isSafeInteger`.

Manual entries accept only `MANUAL_CREDIT`, `PURCHASE`, or `CORRECTION` types with sign/type consistency:

- `PURCHASE` must be negative.
- `MANUAL_CREDIT` must be positive.
- `CORRECTION` may have either sign but not zero.

- [ ] **Step 4: Run ledger tests**

Run: `pnpm --filter @family/api test -- ledger.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit the ledger**

```bash
git add apps/api/src/ledger apps/api/test/ledger.test.ts
git commit -m "feat: add immutable child reward ledger"
```

---

### Task 6: Atomic and Idempotent Parent Approval

**Files:**
- Modify: `apps/api/src/chores/repository.ts`
- Modify: `apps/api/src/chores/service.ts`
- Modify: `apps/api/src/ledger/repository.ts`
- Create: `apps/api/test/approvals.test.ts`

**Interfaces:**
- Consumes: `ChoreService`, `LedgerRepository`, transaction boundary.
- Produces: `ChoreService.approve(actor, command)` and `ChoreService.reject(actor, command)`.

- [ ] **Step 1: Write failing approval tests**

Test:

```ts
it('approves and credits the adjusted payout in one transaction');
it('returns the original result when the same idempotency key is retried');
it('creates one decision and one credit when two parents approve concurrently');
it('rolls back chore approval when ledger insertion fails');
it('reject-and-retry returns the instance to AVAILABLE without a credit');
it('reject-and-close closes the instance without a credit');
it('rejects payout values below zero or above the configured household ceiling');
```

Set the initial household payout ceiling to `100_00` cents through validated configuration; it is a safety limit, not a product maximum.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @family/api test -- approvals.test.ts`  
Expected: FAIL because approval methods do not exist.

- [ ] **Step 3: Implement approval as one serializable transaction**

Within a transaction:

1. Look up `(household_id, idempotency_key)` and return its stored response if present.
2. Lock the `AWAITING_APPROVAL` chore row.
3. Insert the approval decision under the unique chore constraint.
4. Insert one `CHORE_CREDIT` ledger entry using the final amount.
5. Change the chore to `APPROVED` and insert its transition.
6. Insert an audit event.
7. Store the stable command response against the idempotency key.
8. Commit and return the stored response.

Map uniqueness races to the already-recorded decision rather than a 500 response.

- [ ] **Step 4: Implement both rejection outcomes**

`retry: true` changes `AWAITING_APPROVAL -> AVAILABLE`, clears claimant/deadline fields, and retains history. `retry: false` changes `AWAITING_APPROVAL -> CLOSED`. Both record parent, reason, decision, transition, and audit event in one transaction; neither writes the ledger.

- [ ] **Step 5: Run approval and ledger tests repeatedly**

Run: `pnpm --filter @family/api test -- approvals.test.ts ledger.test.ts --repeat=10`  
Expected: PASS with one credit in every concurrency iteration.

- [ ] **Step 6: Commit approval semantics**

```bash
git add apps/api/src/chores apps/api/src/ledger apps/api/test/approvals.test.ts
git commit -m "feat: add atomic parent chore approval"
```

---

### Task 7: Idempotent Expiration Worker

**Files:**
- Create: `apps/api/src/workers/expire.ts`
- Create: `apps/api/test/expiration.test.ts`

**Interfaces:**
- Consumes: `Database`, `Clock`, chore tables.
- Produces: `expireClaimedChores(db, now, batchSize): Promise<number>`.

- [ ] **Step 1: Write failing worker tests**

```ts
it('returns overdue claimed chores to AVAILABLE and records EXPIRED');
it('does not expire a chore at or before a future deadline');
it('is safe when two workers run concurrently');
it('is safe to rerun after the batch is complete');
it('does not modify AWAITING_APPROVAL chores');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @family/api test -- expiration.test.ts`  
Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement batched expiration**

Select due rows with `FOR UPDATE SKIP LOCKED`, limit by `batchSize`, update to `AVAILABLE`, clear active claimant/deadline fields, and insert one `EXPIRED` transition per row in the same transaction. Return the number expired. Validate `batchSize` between 1 and 500.

- [ ] **Step 4: Run worker and lifecycle tests**

Run: `pnpm --filter @family/api test -- expiration.test.ts chores.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit expiration handling**

```bash
git add apps/api/src/workers apps/api/test/expiration.test.ts
git commit -m "feat: expire abandoned chore claims safely"
```

---

### Task 8: HTTP API, Development Authentication, and End-to-End Verification

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/auth/actor-context.ts`
- Create: `apps/api/src/households/routes.ts`
- Create: `apps/api/src/chores/routes.ts`
- Create: `apps/api/src/ledger/routes.ts`
- Create: `apps/api/test/api.test.ts`
- Create: `apps/api/test/e2e.test.ts`
- Create: `apps/api/README.md`

**Interfaces:**
- Consumes: Contract schemas and all core services.
- Produces: Versioned `/v1` JSON API, structured error responses, health endpoint, and later-client integration boundary.

- [ ] **Step 1: Write failing API contract tests**

Use `Fastify.inject` to test:

```ts
it('returns 401 without an actor');
it('returns 403 when a dashboard calls a parent route');
it('returns 400 with field paths for invalid input');
it('returns 409 CHORE_UNAVAILABLE for a lost claim race');
it('deeply validates every successful response with @family/contracts');
it('never includes stack traces or database messages in responses');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @family/api test -- api.test.ts`  
Expected: FAIL because the application and routes do not exist.

- [ ] **Step 3: Compose the Fastify application**

Register JSON limits, request IDs, error mapping, authentication, and routes. Required endpoints:

```text
GET    /health/live
GET    /health/ready
POST   /v1/households
POST   /v1/children
POST   /v1/chore-templates
POST   /v1/chore-instances
GET    /v1/chore-instances?status=AVAILABLE
POST   /v1/chore-instances/:id/claim
POST   /v1/chore-instances/:id/submit
POST   /v1/chore-instances/:id/extend
POST   /v1/chore-instances/:id/cancel
POST   /v1/chore-instances/:id/approve
POST   /v1/chore-instances/:id/reject
GET    /v1/children/:id/ledger
POST   /v1/children/:id/ledger
```

Every mutation accepts `Idempotency-Key` as a UUID header and passes it into the corresponding command. Return stable `ApiError` bodies with `code`, `message`, `requestId`, and optional `fieldErrors`.

- [ ] **Step 4: Add strictly development-only actor authentication**

For `NODE_ENV=development` or `test`, accept signed fixture tokens issued by a test helper. For `NODE_ENV=production`, application startup must fail unless a real `ActorAuthenticator` implementation is configured. Never accept plain actor/household headers. The later Google-auth plan will replace the production adapter without changing service signatures.

- [ ] **Step 5: Write one complete end-to-end test**

Using HTTP only:

1. Create a household, parent, dashboard, and two children through fixtures.
2. Parent creates a “Tidy toys” template worth 250 cents with a 15-minute duration.
3. Parent publishes it.
4. Dashboard lists and claims it for Avery.
5. Riley's concurrent claim receives `CHORE_UNAVAILABLE`.
6. Dashboard submits it for Avery.
7. Parent approves for 300 cents with idempotency key and note “Great job!”.
8. Retry the identical approval.
9. Assert both responses have the same decision ID.
10. Assert Avery's balance is exactly 300 cents and has one ledger transaction.

- [ ] **Step 6: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Expected: every command exits 0. Review test output to confirm PostgreSQL integration tests ran rather than being skipped.

- [ ] **Step 7: Document local API operation**

In `apps/api/README.md`, document Node/pnpm requirements, how to start the explicit PostgreSQL container, migrate, run tests, run the API, obtain development fixture tokens, inspect health endpoints, and stop the database without removing its volume. State prominently that development tokens are rejected in production.

- [ ] **Step 8: Commit the working vertical slice**

```bash
git add apps/api packages/contracts scripts db package.json pnpm-lock.yaml
git commit -m "feat: expose core family chore and ledger API"
```

---

## Plan Completion Gate

Before starting the next subsystem plan:

1. Run the complete verification commands from Task 8 and capture the output.
2. Start from a fresh PostgreSQL database and run the HTTP end-to-end test.
3. Inspect the database to confirm one approval decision and one ledger credit after an approval retry.
4. Review every public API response against `@family/contracts`.
5. Confirm production startup rejects the development authentication adapter.
6. Request code review using `superpowers:requesting-code-review`.
7. Use `superpowers:finishing-a-development-branch` to decide how to integrate the completed vertical slice.

## Approved-Spec Coverage Audit

This plan implements the approved specification's product principles, role boundary primitives, chore library and pool, claim/submission/expiration state machine, atomic approval, immutable ledger, household isolation, audit primitives, server-authoritative error behavior, and core automated tests.

The following approved requirements are intentionally assigned to named follow-up plans rather than omitted:

- Google parent login, household onboarding, device pairing, parent mobile UI, approval inbox, and direct APNs/FCM delivery: **Parent mobile authentication, approval inbox, and push notifications**
- Family-overview display, child interaction screens, cached reads, reconnect reconciliation, and Chromium kiosk recovery: **Raspberry Pi dashboard and offline kiosk behavior**
- Google OAuth refresh-token encryption, calendar selection/mapping, incremental sync, stale-data labels, agenda, and weather card: **Google Calendar authorization, synchronization, and agenda UI**
- Savings goal progress, celebration acknowledgement, sound/reduced-motion settings, and thank-you notes: **Savings goals, celebration packs, and parent thank-you notes**
- Self-hosted Supabase, production authentication adapter, private storage, Caddy, Cloudflare Tunnel, split-horizon DNS, encrypted backups, restoration drills, monitoring, and production secrets: **Ubuntu deployment, Caddy, Cloudflare Tunnel, backups, and monitoring**
- Signed webhook subscriptions, delivery retry/logging, credential rotation, data export, accessibility hardening, and final release acceptance: **Home Assistant webhooks and operational hardening**
