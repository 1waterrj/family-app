# Family Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private local feedback queue to the parent and kitchen applications, attach bounded safe diagnostics, let parents scrub reports, and hand a validated issue draft to the public GitHub repository without storing GitHub credentials.

**Architecture:** Shared Zod contracts define the only diagnostic and feedback shapes accepted across the system. The existing API-client package owns a typed rolling diagnostic buffer, persistent outbox, and pure GitHub-handoff builder; the Fastify API owns household-scoped feedback storage, privacy analysis, public preview generation, rate limiting, and retention. The native parent app exposes submission, Inbox, review, and device-local maintainer export, while the dashboard exposes child-friendly submission only.

**Tech Stack:** TypeScript 6, Zod 4, Fastify 5, Drizzle ORM/PostgreSQL, Expo 57/React Native 0.86, React 19, Vite 8 PWA, TanStack Query 5, Vitest 4, Jest 29, Playwright 1.62, pnpm 11.16.0, Node.js >=24 <25.

## Global Constraints

- Keep this milestone LAN/local-development only; do not add public ingress, port forwarding, or a public reverse proxy.
- Use one Expo parent codebase for iPhone and Android, one dashboard PWA, and one local API in the existing monorepo.
- Never store or transmit a GitHub password, personal access token, OAuth token, or GitHub App credential.
- Keep diagnostic history to at most 15 minutes, 100 events, and 24 KiB of serialized event data; evict the oldest event first.
- Never record authorization headers, cookies, credentials, request/response bodies, arbitrary URLs, query strings, names, calendar content, chore content, balances, notes, form values, or uncontrolled error objects.
- Keep feedback private on the Ubuntu server until a parent explicitly prepares a public preview and GitHub presents its own final submit action.
- Both parents retain equal household permissions; maintainer mode is a device-local display preference only.
- A dashboard may create feedback but may never list, read, edit, delete, close, preview, or export feedback.
- Closed server reports are deleted 30 days after closure; unresolved reports remain until a parent closes or deletes them.
- Dashboard outbox drafts expire after 30 days; parent outbox drafts remain until delivery or explicit deletion.
- Use public npm only. Do not reference or configure unrelated company infrastructure.
- Follow TDD for every behavior: observe the focused test fail before adding implementation, then run the focused test and the affected package suite before committing.

---

## File and responsibility map

### Shared contracts and client infrastructure

- Create `packages/contracts/src/feedback.ts`: feedback commands, reports, diagnostics, privacy findings, and public-preview schemas.
- Create `packages/contracts/test/feedback.test.ts`: strict contract and hostile-payload coverage.
- Modify `packages/contracts/src/common.ts`: add `FeedbackIdSchema` and `RATE_LIMITED` API error code.
- Modify `packages/contracts/src/index.ts`: export feedback contracts.
- Create `packages/api-client/src/diagnostics.ts`: bounded structured buffer and safe diagnostic `fetch` wrapper.
- Create `packages/api-client/src/feedback-outbox.ts`: scope-aware persistent retry queue.
- Create `packages/api-client/src/github-handoff.ts`: pure URL/clipboard handoff decision.
- Modify `packages/api-client/src/client.ts`: feedback API methods.
- Modify `packages/api-client/src/errors.ts`: map HTTP 429 to `RATE_LIMITED`.
- Modify `packages/api-client/src/query-keys.ts`: feedback list/detail keys.
- Modify `packages/api-client/src/index.ts`: export the shared feedback utilities.
- Create focused tests under `packages/api-client/test/` for each utility and endpoint group.

### Local API

- Modify `apps/api/src/db/schema.ts`: feedback enums/table, constraints, and indexes.
- Generate `db/migrations/0010_feedback-reports.sql` plus Drizzle journal/snapshot files.
- Create `apps/api/src/feedback/repository.ts`: household-scoped persistence and safe audit writes.
- Create `apps/api/src/feedback/service.ts`: permissions, idempotency, dashboard rate limit, CRUD, and preview orchestration.
- Create `apps/api/src/feedback/routes.ts`: strict HTTP boundary.
- Create `apps/api/src/feedback/privacy.ts`: PII findings, deterministic redaction, and Markdown construction.
- Create `apps/api/src/workers/feedback-retention.ts`: bounded closed-report deletion and interval lifecycle.
- Modify `apps/api/src/config.ts`, `apps/api/src/app.ts`, and `apps/api/src/server.ts`: optional repository configuration, module registration, error mapping, and retention startup.
- Modify `apps/api/src/dev/seed.ts`: clear deterministic-household feedback before reseeding.
- Add API, schema, privacy, config, and retention tests.

### Parent application

- Create `apps/parent/src/features/feedback/feedback-runtime.tsx`: diagnostic buffer, outbox, session-aware flush, and contextual draft state.
- Create `apps/parent/src/features/feedback/feedback-queries.ts`: TanStack feedback queries/mutations.
- Create `apps/parent/src/features/feedback/maintainer-settings.ts`: device-local maintainer preference.
- Create `apps/parent/src/features/feedback/highlighted-private-text.tsx`: accessible PII-span rendering.
- Create `apps/parent/src/screens/send-feedback-screen.tsx`, `feedback-inbox-screen.tsx`, `feedback-detail-screen.tsx`, and `feedback-export-screen.tsx`.
- Add Expo Router files `apps/parent/app/(tabs)/feedback.tsx`, `apps/parent/app/feedback/new.tsx`, `apps/parent/app/feedback/[feedbackId].tsx`, and `apps/parent/app/feedback/export/[feedbackId].tsx`.
- Modify the parent provider, tab/stack layouts, persisted-query allowlist, and relevant error states.
- Add parent Jest coverage for runtime, submission, Inbox, review, export, and contextual reporting.

### Kitchen dashboard

- Create `apps/dashboard/src/screens/feedback-screen.tsx` and `apps/dashboard/src/components/tell-us-button.tsx`.
- Modify `apps/dashboard/src/app.tsx`: diagnostic runtime, persistent outbox, always-available feedback overlay, retry lifecycle, and strict dashboard-only submission.
- Modify dashboard screens and styles for persistent access, screen events, contextual reporting, and accessible feedback choices.
- Add dashboard Vitest coverage for submission, offline retry, expiry, rate limiting, and absence of Inbox/export controls.

### Repository delivery

- Create `.github/ISSUE_TEMPLATE/app-feedback.md`: public issue fallback template.
- Create `scripts/verify-no-github-credentials.mjs` and its test.
- Modify production verification and development documentation.
- Add `e2e/dashboard-feedback-flow.spec.ts` for the cross-client browser/API journey.

---

### Task 1: Define strict feedback and diagnostic contracts

**Files:**
- Create: `packages/contracts/src/feedback.ts`
- Create: `packages/contracts/test/feedback.test.ts`
- Modify: `packages/contracts/src/common.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `FeedbackId`, `FeedbackCategory`, `FeedbackSource`, `FeedbackStatus`, `FeedbackDiagnosticEvent`, `ClientDiagnosticSnapshot`, `CreateFeedbackCommand`, `FeedbackSubmissionReceipt`, `UpdateFeedbackCommand`, `FeedbackReport`, `FeedbackListItem`, `FeedbackPublicPreviewRequest`, `FeedbackPublicPreview`, and their schemas.
- Produces: `RATE_LIMITED` as a contracted `ApiErrorCode`.
- Consumes: existing branded IDs, `IsoUtcTimestampSchema`, and `ApiErrorCodeSchema` conventions.

- [ ] **Step 1: Write failing strict-schema tests**

Add tests that parse one valid snapshot/report, reject unknown diagnostic keys, reject more than 100 events, reject arbitrary screen/operation strings, and reject credential/body-like additions:

```ts
const event = {
  kind: 'API_RESULT',
  at: '2026-08-10T12:00:00.000Z',
  operation: 'GET_PARENT_SNAPSHOT',
  outcome: 'ERROR',
  status: 503,
  errorCode: 'INTERNAL_ERROR',
  durationBucket: 'UNDER_1_SECOND',
  requestId: '10000000-0000-4000-8000-000000000001',
} as const;

expect(FeedbackDiagnosticEventSchema.parse(event)).toEqual(event);
expect(() =>
  FeedbackDiagnosticEventSchema.parse({
    ...event,
    authorization: 'Bearer must-never-parse',
  }),
).toThrow();
```

Also assert `CreateFeedbackCommandSchema` trims the description, requires a UUID idempotency key, accepts an empty description, and rejects a diagnostic snapshot above 24 KiB through the exported `MAX_DIAGNOSTIC_BYTES` check used by the server.

- [ ] **Step 2: Run the focused contract test and confirm failure**

Run: `pnpm exec vitest run packages/contracts/test/feedback.test.ts`

Expected: FAIL because `feedback.ts` and its exports do not exist.

- [ ] **Step 3: Add the feedback identifiers and enums**

Add `FeedbackIdSchema = z.uuid().brand<'FeedbackId'>()` to `common.ts`, add `RATE_LIMITED` to `ApiErrorCodeSchema`, and define these exact enums in `feedback.ts`:

```ts
export const FeedbackCategorySchema = z.enum(['BROKEN', 'CONFUSING', 'IDEA']);
export const FeedbackSourceSchema = z.enum([
  'PARENT_IOS',
  'PARENT_ANDROID',
  'DASHBOARD',
]);
export const FeedbackStatusSchema = z.enum([
  'NEW',
  'REVIEWING',
  'READY',
  'EXPORTED',
  'CLOSED',
]);
export const FeedbackScreenSchema = z.enum([
  'SETUP',
  'PARENT_HOME',
  'PARENT_APPROVALS',
  'PARENT_CHORES',
  'PARENT_REWARDS',
  'PARENT_FEEDBACK',
  'PARENT_FEEDBACK_DETAIL',
  'PARENT_FEEDBACK_EXPORT',
  'DASHBOARD_HOME',
  'DASHBOARD_CHORE_BOARD',
  'DASHBOARD_CHORE_DETAIL',
  'DASHBOARD_ACTIVE_CHORE',
  'DASHBOARD_FEEDBACK',
]);
```

Define fixed `FeedbackApiOperationSchema`, `FeedbackConnectionStateSchema`, and `FeedbackDurationBucketSchema` enums. Include every current API operation plus the six feedback operations; do not include a free-form route field.

- [ ] **Step 4: Add discriminated diagnostic and feedback schemas**

Use `.strict()` at every object boundary. Model screen, network, and API result events as a discriminated union:

```ts
export const FeedbackDiagnosticEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SCREEN'),
    at: IsoUtcTimestampSchema,
    screen: FeedbackScreenSchema,
  }).strict(),
  z.object({
    kind: z.literal('NETWORK'),
    at: IsoUtcTimestampSchema,
    state: FeedbackConnectionStateSchema,
  }).strict(),
  z.object({
    kind: z.literal('API_RESULT'),
    at: IsoUtcTimestampSchema,
    operation: FeedbackApiOperationSchema,
    outcome: z.enum(['SUCCESS', 'ERROR']),
    status: z.number().int().min(100).max(599).nullable(),
    errorCode: ApiErrorCodeSchema.nullable(),
    durationBucket: FeedbackDurationBucketSchema,
    requestId: z.uuid().nullable(),
  }).strict(),
]);
```

Export constants `DIAGNOSTIC_WINDOW_MS = 900_000`, `MAX_DIAGNOSTIC_EVENTS = 100`, `MAX_DIAGNOSTIC_BYTES = 24 * 1_024`, `MAX_FEEDBACK_DESCRIPTION_LENGTH = 2_000`, and `MAX_FEEDBACK_TITLE_LENGTH = 160`.

Define strict command/report schemas with these field names:

```ts
type CreateFeedbackCommand = {
  idempotencyKey: string;
  category: FeedbackCategory;
  description: string;
  diagnosticSnapshot: ClientDiagnosticSnapshot;
};

type UpdateFeedbackCommand = {
  idempotencyKey: string;
  title?: string;
  description?: string;
  diagnosticEvents?: FeedbackDiagnosticEvent[];
  status?: FeedbackStatus;
  publicIssueUrl?: string | null;
};

type FeedbackPublicPreviewRequest = {
  publicTitle: string;
  publicDescription: string;
  includeDiagnostics: boolean;
};
```

Define `ClientDiagnosticSnapshot` exactly as `{ source, appVersion,
currentScreen, events }`. Its schema must cap `events` at 100 and refine the
serialized event array to at most 24 KiB. `UpdateFeedbackCommand` may replace
the events with a strict subset or an empty array, but it cannot change the
original source, version, or current screen.

Define `FeedbackPrivacyFinding` as `{ field: 'TITLE' | 'DESCRIPTION', kind,
start, end }`, where `kind` is one of `KNOWN_PRIVATE_TERM`, `EMAIL`,
`IP_ADDRESS`, `HOSTNAME`, `UUID`, `CREDENTIAL`, or `LINK`. Offsets are UTF-16
string offsets and must satisfy `0 <= start < end`.

`FeedbackListItem` contains `id`, `category`, `source`, `appVersion`, `screen`,
`status`, `descriptionPreview`, `hasDiagnostics`, `createdAt`, and `updatedAt`.
`FeedbackSubmissionReceipt` contains only `id`, `status`, and `createdAt`, so a
dashboard create response cannot echo private text or diagnostics.
`FeedbackReport` adds `title`, full `description`, `diagnosticSnapshot`,
`privacyFindings`, nullable `publicIssueUrl`, and lifecycle timestamps, but
never returns the submitting actor ID. `DeleteFeedbackCommand` contains only a
UUID `idempotencyKey`; `DeletedFeedback` is `{ id, deleted: true }`.

`FeedbackPublicPreview` contains validated `repositoryUrl`, `title`, `body`,
`labels`, and a deduplicated array of redaction kinds. Repository URLs must use
HTTPS, host `github.com`, exactly two path segments, and no credentials, port,
query, or fragment.

- [ ] **Step 5: Export contracts and run the package tests**

Run:

```bash
pnpm exec vitest run packages/contracts/test/feedback.test.ts
pnpm --filter @family/contracts typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add packages/contracts
git commit -m "feat: define feedback contracts"
```

---

### Task 2: Build the safe diagnostic buffer, outbox, and handoff primitives

**Files:**
- Create: `packages/api-client/src/diagnostics.ts`
- Create: `packages/api-client/src/feedback-outbox.ts`
- Create: `packages/api-client/src/github-handoff.ts`
- Create: `packages/api-client/test/diagnostics.test.ts`
- Create: `packages/api-client/test/feedback-outbox.test.ts`
- Create: `packages/api-client/test/github-handoff.test.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Produces: `createDiagnosticBuffer(options): DiagnosticBuffer`.
- Produces: `createDiagnosticFetch(fetch, buffer, now): typeof fetch`.
- Produces: `createFeedbackOutbox(options): FeedbackOutbox` with `enqueue`, `list`, `flush`, and `remove`.
- Produces: `buildGithubIssueHandoff(preview, maxUrlLength?): GithubIssueHandoff`.
- Consumes: Task 1 feedback contracts.

- [ ] **Step 1: Write failing buffer and hostile-input tests**

Use a controlled clock to record events older and newer than 15 minutes. Assert oldest-first eviction at 100 events and 24 KiB. Wrap a fake `fetch` and assert it records a templated operation, coarse duration, status, contracted error code, and request ID without preserving URL query strings, request bodies, response bodies, or headers.

```ts
const buffer = createDiagnosticBuffer({
  source: 'PARENT_IOS',
  appVersion: '0.1.0',
  now: () => now,
});
buffer.recordScreen('PARENT_HOME');
buffer.recordNetwork('OFFLINE');
expect(buffer.snapshot().events.map(({ kind }) => kind)).toEqual([
  'SCREEN',
  'NETWORK',
]);
```

- [ ] **Step 2: Write failing scope-aware outbox tests**

Use an in-memory `StringStorage` and assert:

- a draft survives a new outbox instance;
- a null-scope setup draft binds to the first authenticated scope;
- a draft bound to household scope A never flushes under scope B;
- successful delivery removes the entry;
- failure keeps the entry and stops the drain;
- dashboard configuration removes drafts older than 30 days.

```ts
await outbox.enqueue(command, undefined);
await reloaded.flush({ scope: parentScope, deliver });
expect(deliver).toHaveBeenCalledWith(command);
expect(await reloaded.list()).toEqual([]);
```

- [ ] **Step 3: Write failing GitHub-handoff tests**

Assert a short preview returns a URL handoff whose origin is exactly
`https://github.com`, whose path ends in `/issues/new`, and whose decoded title/body match the preview. Assert a preview above the configured encoded limit returns a clipboard handoff with a blank issue-composer URL and the full validated Markdown.

```ts
expect(buildGithubIssueHandoff(shortPreview)).toMatchObject({ kind: 'URL' });
expect(buildGithubIssueHandoff(longPreview, 200)).toEqual({
  kind: 'CLIPBOARD',
  issueComposerUrl: 'https://github.com/family-tests/family-app/issues/new',
  markdown: `${longPreview.title}\n\n${longPreview.body}`,
});
```

- [ ] **Step 4: Run focused tests and confirm failure**

Run:

```bash
pnpm exec vitest run packages/api-client/test/diagnostics.test.ts packages/api-client/test/feedback-outbox.test.ts packages/api-client/test/github-handoff.test.ts
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 5: Implement the typed diagnostic buffer and fetch wrapper**

Expose only typed recording functions:

```ts
export interface DiagnosticBuffer {
  recordScreen(screen: FeedbackScreen): void;
  recordNetwork(state: FeedbackConnectionState): void;
  recordApiResult(input: {
    operation: FeedbackApiOperation;
    outcome: 'SUCCESS' | 'ERROR';
    status: number | null;
    errorCode: ApiErrorCode | null;
    durationBucket: FeedbackDurationBucket;
    requestId: string | null;
  }): void;
  snapshot(): ClientDiagnosticSnapshot;
}
```

Map `Request.method + URL.pathname` to the fixed operation enum with anchored regular expressions. Return no match for unknown paths. Clone error responses and parse only `ApiErrorSchema`; never store the cloned payload. Use duration buckets `UNDER_250_MS`, `UNDER_1_SECOND`, `UNDER_5_SECONDS`, and `FIVE_SECONDS_OR_MORE`.

- [ ] **Step 6: Implement the persistent outbox**

Use this storage boundary and result shape:

```ts
export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface FeedbackOutbox {
  enqueue(command: CreateFeedbackCommand, scope?: string): Promise<string>;
  list(): Promise<readonly FeedbackOutboxEntry[]>;
  flush(options: {
    scope: string;
    deliver(command: CreateFeedbackCommand): Promise<FeedbackSubmissionReceipt>;
  }): Promise<{ deliveredEntryIds: string[]; stoppedOnError: boolean }>;
  remove(entryId: string): Promise<void>;
}
```

Parse stored JSON with a private strict Zod schema. Treat malformed storage as an empty outbox after removing the malformed value. Serialize writes behind one promise chain so concurrent enqueue/flush calls cannot lose entries.

- [ ] **Step 7: Implement the pure handoff builder**

Validate `preview.repositoryUrl` as a two-segment `https://github.com` repository URL before construction. Use `URLSearchParams` for `title`, `body`, and comma-separated `labels`. Return:

```ts
type GithubIssueHandoff =
  | { kind: 'URL'; url: string }
  | {
      kind: 'CLIPBOARD';
      issueComposerUrl: string;
      markdown: string;
    };
```

Use a conservative default encoded URL limit of 7,000 characters.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run packages/api-client/test/diagnostics.test.ts packages/api-client/test/feedback-outbox.test.ts packages/api-client/test/github-handoff.test.ts
pnpm --filter @family/api-client typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit the reusable client infrastructure**

```bash
git add packages/api-client
git commit -m "feat: add safe feedback client primitives"
```

---

### Task 3: Add feedback persistence and migration constraints

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/dev/seed.ts`
- Create: `db/migrations/0010_feedback-reports.sql`
- Create: `db/migrations/meta/0010_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`
- Modify: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces: `feedbackCategoryEnum`, `feedbackSourceEnum`, `feedbackStatusEnum`, and `feedbackReports` Drizzle table.
- Consumes: Task 1 enums and `ClientDiagnosticSnapshot` JSON type.

- [ ] **Step 1: Add failing database constraint tests**

Extend `schema.test.ts` with a fixture that verifies:

- parent and dashboard submitter columns match `submitted_by_role`;
- report title/description limits are enforced;
- source is one of the three contracted values;
- household/report composite identity is unique;
- deleting a household cascades feedback;
- the household/status/creation ordering index exists;
- a seeded fixed household can be refreshed with feedback present.

- [ ] **Step 2: Run the schema test and confirm failure**

Run: `pnpm --filter @family/api test -- test/schema.test.ts`

Expected: FAIL because `feedback_reports` does not exist.

- [ ] **Step 3: Add the Drizzle table**

Define a `feedback_reports` table with these columns:

```ts
{
  id: uuid().defaultRandom().primaryKey(),
  householdId: uuid().notNull(),
  submittedByRole: actorRoleEnum().notNull(),
  submittedByParentId: uuid(),
  submittedByDashboardDeviceId: uuid(),
  category: feedbackCategoryEnum().notNull(),
  title: varchar({ length: 160 }).notNull(),
  description: text().notNull(),
  source: feedbackSourceEnum().notNull(),
  appVersion: varchar({ length: 64 }).notNull(),
  screen: varchar({ length: 64 }).notNull(),
  diagnosticSnapshot: jsonb().$type<ClientDiagnosticSnapshot>().notNull(),
  status: feedbackStatusEnum().default('NEW').notNull(),
  reviewedByParentId: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  publicIssueUrl: text(),
  exportedAt: timestamp({ withTimezone: true }),
  closedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}
```

Add composite foreign keys to household parent/dashboard records, a role/actor check, `char_length(description) <= 2000`, a household/id unique key, a household/status/created-at index, and a dashboard-actor/created-at index for rate limiting.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
pnpm --filter @family/api exec drizzle-kit generate --config drizzle.config.ts --name feedback-reports
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
```

Expected: one `0010_feedback-reports.sql` migration, one `0010_snapshot.json`, an updated journal, and a successful Drizzle check. Inspect the SQL to confirm all foreign keys, checks, and indexes are present exactly once.

- [ ] **Step 5: Make deterministic seeding feedback-safe**

Import `feedbackReports` in `apps/api/src/dev/seed.ts` and delete fixed-household feedback before parent/device/household fixture rows, inside the existing seed transaction. Do not reset feedback for any non-fixture household.

```ts
await transaction
  .delete(feedbackReports)
  .where(eq(feedbackReports.householdId, DEVELOPMENT_HOUSEHOLD_ID));
```

- [ ] **Step 6: Run schema, seed, and Drizzle tests**

Run:

```bash
pnpm --filter @family/api test -- test/schema.test.ts test/dev-seed.test.ts
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
```

Expected: PASS.

- [ ] **Step 7: Commit persistence**

```bash
git add apps/api/src/db/schema.ts apps/api/src/dev/seed.ts apps/api/test/schema.test.ts db/migrations
git commit -m "feat: persist private feedback reports"
```

---

### Task 4: Implement household-scoped feedback CRUD and rate limiting

**Files:**
- Create: `apps/api/src/feedback/repository.ts`
- Create: `apps/api/src/feedback/service.ts`
- Create: `apps/api/src/feedback/routes.ts`
- Create: `apps/api/test/feedback.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces: `FeedbackRepository`, `FeedbackService`, `feedbackRoutes`.
- Produces API: create/list/get/update/delete under `/v1/feedback`.
- Consumes: Task 1 contracts, Task 3 table, existing `ActorContext`, `IdempotentCommandExecutor`, and `auditEvents`.

- [ ] **Step 1: Write failing API authorization and workflow tests**

Cover these requests with real Testcontainers fixtures:

```ts
const createResponse = await app.inject({
  method: 'POST',
  url: '/v1/feedback',
  headers: mutationHeaders(dashboard),
  payload: validCreateFeedback,
});
expect(createResponse.statusCode).toBe(201);
```

Assert parent and dashboard creation return only the strict submission receipt,
idempotent replay returns the same receipt, parent list/get/update/delete works,
dashboard receives 403 on every non-create endpoint, cross-household access is
404, invalid bodies return field paths, and audit events contain only
category/source/status metadata.

Assert a dashboard cannot claim a parent source and a parent cannot claim the
dashboard source. Require screen identifiers to match the source family, except
the shared `SETUP` screen.

Create six reports from one dashboard within ten minutes. Assert the first five succeed and the sixth returns HTTP 429 with contracted code `RATE_LIMITED`. Replay an accepted idempotency key after the limit and assert it still returns the stored receipt.

- [ ] **Step 2: Run the API test and confirm failure**

Run: `pnpm --filter @family/api test -- test/feedback.test.ts`

Expected: FAIL with 404 feedback routes.

- [ ] **Step 3: Implement the repository boundary**

Give `FeedbackRepository` these explicit methods:

```ts
findSubmittingActor(transaction, actor): Promise<unknown | undefined>
insert(transaction, actor, command, now, title): Promise<FeedbackRow>
listByHousehold(database, householdId): Promise<FeedbackRow[]>
findByHousehold(databaseOrTransaction, householdId, feedbackId): Promise<FeedbackRow | undefined>
update(transaction, householdId, feedbackId, patch): Promise<FeedbackRow | undefined>
delete(transaction, householdId, feedbackId): Promise<FeedbackRow | undefined>
countDashboardSubmissionsSince(transaction, householdId, dashboardId, since): Promise<number>
insertAuditEvent(transaction, actor, feedbackId, eventType, payload, now): Promise<void>
```

Every lookup includes `household_id`; never load a report by ID alone. Order lists by newest `created_at`, then ID.

- [ ] **Step 4: Implement service rules and idempotency**

Use `DASHBOARD_FEEDBACK_LIMIT = 5` and `DASHBOARD_FEEDBACK_WINDOW_MS = 10 * 60 * 1_000`. The create command must execute through `IdempotentCommandExecutor` with operation `CREATE_FEEDBACK`. Inside its serializable work:

1. verify the actor still belongs to the household;
2. verify source/screen metadata matches the actor role;
3. enforce the dashboard limit;
4. derive the default title from category and source;
5. insert the report;
6. insert a content-free audit event;
7. return `FeedbackSubmissionReceiptSchema.parse({ id, status, createdAt })`
   rather than the stored report.

```ts
return this.idempotency.execute({
  actor,
  idempotencyKey: command.idempotencyKey,
  operation: 'CREATE_FEEDBACK',
  request: command,
  responseSchema: FeedbackSubmissionReceiptSchema,
  work: async (transaction) =>
    this.createOnce(transaction, actor, command),
});
```

Require `requireParent` for list/get/update/delete. Use idempotent operations `UPDATE_FEEDBACK` and `DELETE_FEEDBACK`. Updates set `reviewedByParentId/reviewedAt`; setting `EXPORTED` sets `exportedAt`, setting `CLOSED` sets `closedAt`, and moving out of either state clears the corresponding timestamp.

When `diagnosticEvents` is present, rebuild the stored snapshot with its
original `source`, `appVersion`, and `currentScreen`; replace only `events`.
Parse the rebuilt snapshot and enforce its serialized-size bound again before
writing.

Return an empty `privacyFindings` array in this task's report mapper. Task 5
replaces that temporary safe default with findings computed from the current
title, description, and household terms before a report is returned to a
parent.

- [ ] **Step 5: Add strict routes and error mapping**

Expose:

```text
POST   /v1/feedback
GET    /v1/feedback
GET    /v1/feedback/:id
PATCH  /v1/feedback/:id
DELETE /v1/feedback/:id
```

Read UUID idempotency keys from `idempotency-key` on create/update/delete and map validation paths to `headers.idempotency-key`, `path.id`, or `body.*`. Map the feedback rate error to HTTP 429 and `RATE_LIMITED`; map missing household records to the existing sanitized 404 behavior.

- [ ] **Step 6: Run API and authorization suites**

Run:

```bash
pnpm --filter @family/api test -- test/feedback.test.ts test/authorization.test.ts test/api.test.ts
pnpm --filter @family/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the private Inbox API**

```bash
git add apps/api/src/feedback apps/api/src/app.ts apps/api/test/feedback.test.ts
git commit -m "feat: add private feedback inbox api"
```

---

### Task 5: Add public sanitization, repository configuration, and retention

**Files:**
- Create: `apps/api/src/feedback/privacy.ts`
- Create: `apps/api/src/workers/feedback-retention.ts`
- Create: `apps/api/test/feedback-privacy.test.ts`
- Create: `apps/api/test/feedback-retention.test.ts`
- Create: `apps/api/test/config.test.ts`
- Modify: `apps/api/src/feedback/repository.ts`
- Modify: `apps/api/src/feedback/service.ts`
- Modify: `apps/api/src/feedback/routes.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/test/api.test.ts`

**Interfaces:**
- Produces: `findPrivacyFindings(text, knownTerms)`, `buildPublicFeedbackPreview(input)`, `deleteClosedFeedbackBefore(database, cutoff, batchSize)`, and `startFeedbackRetentionWorker(options)`.
- Produces API: `POST /v1/feedback/:id/public-preview`.
- Consumes: Task 4 report service and repository.

- [ ] **Step 1: Write hostile privacy tests before sanitizer code**

Build a report whose title, description, and diagnostics contain fixture family names, household name, email, IPv4, IPv6, hostname, UUID, `Bearer` credential, GitHub-token-shaped string, unsafe Markdown link, and request correlation ID. Assert the preview contains none of the originals and includes deterministic replacements such as `<family-member>`, `<local-server>`, `<email>`, `<credential>`, `<link>`, and `<request-1>`.

Assert an event that fails the strict public-event schema causes the entire diagnostic timeline to be omitted while preserving the sanitized title and description.

```ts
const preview = buildPublicFeedbackPreview(hostileInput);
expect(preview.body).not.toMatch(
  /Avery|Riley|192\.168\.|Bearer|github_pat|calendar title/i,
);
expect(preview.redactions).toContain('KNOWN_PRIVATE_TERM');
```

- [ ] **Step 2: Write failing configuration and retention tests**

Assert:

- absent `FAMILY_FEEDBACK_GITHUB_REPOSITORY` produces `undefined` and disables preview;
- `owner/repository` is accepted and normalized to an HTTPS GitHub repository URL;
- values containing protocols, extra path segments, whitespace, `.git`, query strings, or fragments fail startup validation;
- only `CLOSED` rows older than 30 days are deleted;
- deletion is bounded to 500 rows and can be called repeatedly;
- stopping the worker clears its interval.

```ts
const deleted = await deleteClosedFeedbackBefore(
  database,
  new Date('2026-07-11T00:00:00.000Z'),
  500,
);
expect(deleted).toBe(1);
expect(await listRemainingIds(database)).toEqual([openId, recentClosedId]);
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @family/api test -- test/feedback-privacy.test.ts test/feedback-retention.test.ts test/config.test.ts test/api.test.ts
```

Expected: FAIL because privacy preview, config, and retention behavior do not exist.

- [ ] **Step 4: Implement privacy findings and fail-closed Markdown construction**

Reconstruct output from allowlisted values only. Use known private terms loaded from the household and child-profile tables. Return findings as field/start/end/kind spans without returning a second copy of the matched value.

Apply redactions in descending text-offset order. Strip raw URLs and Markdown links, normalize control characters, cap the public title at 160 characters, cap the body at 6,000 characters, and include at most 40 diagnostic events. Map source/category to these labels:

```ts
const sourceLabels = {
  PARENT_IOS: ['feedback', 'app:parent', 'platform:ios'],
  PARENT_ANDROID: ['feedback', 'app:parent', 'platform:android'],
  DASHBOARD: ['feedback', 'app:dashboard', 'platform:raspberry-pi'],
};
const categoryLabels = {
  BROKEN: 'type:bug',
  CONFUSING: 'type:confusing',
  IDEA: 'type:idea',
};
```

- [ ] **Step 5: Add preview orchestration and route**

Add `FeedbackService.preparePublicPreview(actor, feedbackId, input)`. It must require a parent, load the report and known terms by household, fail with `INVALID_STATE` when repository export is unconfigured, sanitize the parent-provided public title/description on every call, and return `FeedbackPublicPreviewSchema.parse(...)`.

Also compute `privacyFindings` for parent detail/update responses from the
current title/description and known household terms. Create returns only its
receipt; list responses expose only `descriptionPreview` and `hasDiagnostics`
and do not duplicate finding spans.

```ts
async preparePublicPreview(
  actor: ActorContext,
  feedbackId: string,
  input: FeedbackPublicPreviewRequest,
): Promise<FeedbackPublicPreview> {
  const parent = requireParent(actor);
  const report = await this.requireReport(parent, feedbackId);
  const knownTerms = await this.repository.listKnownPrivateTerms(
    this.database,
    parent.householdId,
  );
  return buildPublicFeedbackPreview({
    report,
    input,
    knownTerms,
    repository: this.githubRepository,
  });
}
```

Expose `POST /v1/feedback/:id/public-preview`. This endpoint is read-only and does not require an idempotency key. Dashboard callers receive 403.

- [ ] **Step 6: Add exact repository configuration**

Extend `Config` with `feedbackGithubRepository?: string` and `BuildAppOptions` with the same property. Validate with:

```ts
const GithubRepositorySlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .refine((value) => !value.endsWith('.git'));
```

Pass the value from `server.ts` into `buildApp`. Construct the public URL with `new URL('/' + slug, 'https://github.com')`, then verify origin and exactly two nonempty path segments.

- [ ] **Step 7: Implement bounded retention lifecycle**

Use `FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000`, `FEEDBACK_RETENTION_BATCH_SIZE = 500`, and a six-hour interval. Run one cleanup immediately on server startup, log only deleted count/error category, call `.unref()` on the timer, and stop the timer before closing the database.

```ts
const worker = startFeedbackRetentionWorker({
  database,
  intervalMs: 6 * 60 * 60 * 1_000,
  retentionMs: FEEDBACK_RETENTION_MS,
  batchSize: FEEDBACK_RETENTION_BATCH_SIZE,
  log: app.log,
});
app.addHook('onClose', async () => worker.stop());
```

- [ ] **Step 8: Run privacy, API, retention, and config tests**

Run:

```bash
pnpm --filter @family/api test -- test/feedback-privacy.test.ts test/feedback-retention.test.ts test/config.test.ts test/feedback.test.ts test/api.test.ts
pnpm --filter @family/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit public-preview safety and retention**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: sanitize and retain feedback safely"
```

---

### Task 6: Expose feedback through the shared API client

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/errors.ts`
- Modify: `packages/api-client/src/query-keys.ts`
- Modify: `packages/api-client/src/index.ts`
- Create: `packages/api-client/test/feedback-client.test.ts`
- Modify: `packages/api-client/test/query-keys.test.ts`

**Interfaces:**
- Produces: feedback methods on `FamilyApiClient` and query keys `feedbackList(session)` and `feedbackDetail(session, feedbackId)`.
- Consumes: Task 1 schemas and Task 4/5 endpoints.

- [ ] **Step 1: Write failing client transport tests**

Use a recording fake fetch to assert exact method, path, auth header, JSON body, and idempotency header for create/update/delete. Assert list/get/preview parse contracted responses, malformed responses fail closed, and HTTP 429 maps to `FamilyApiError.kind === 'RATE_LIMITED'` with code `RATE_LIMITED`.

```ts
await client.updateFeedback(feedbackId, updateCommand);
expect(recordedRequest).toMatchObject({
  method: 'PATCH',
  pathname: `/v1/feedback/${feedbackId}`,
  idempotencyKey: updateCommand.idempotencyKey,
});
```

- [ ] **Step 2: Run the client tests and confirm failure**

Run: `pnpm exec vitest run packages/api-client/test/feedback-client.test.ts packages/api-client/test/query-keys.test.ts`

Expected: FAIL because feedback client methods and keys are absent.

- [ ] **Step 3: Add exact client methods**

Extend `FamilyApiClient` with:

```ts
createFeedback(input: CreateFeedbackCommand): Promise<FeedbackSubmissionReceipt>;
listFeedback(): Promise<FeedbackListItem[]>;
getFeedback(feedbackId: string): Promise<FeedbackReport>;
updateFeedback(feedbackId: string, input: UpdateFeedbackCommand): Promise<FeedbackReport>;
deleteFeedback(feedbackId: string, input: DeleteFeedbackCommand): Promise<DeletedFeedback>;
prepareFeedbackPublicPreview(
  feedbackId: string,
  input: FeedbackPublicPreviewRequest,
): Promise<FeedbackPublicPreview>;
```

Generalize the internal request helper to support JSON `POST`, `PATCH`, and `DELETE` while preserving the existing chore behavior. Only state-changing methods send an idempotency key.

- [ ] **Step 4: Add scoped query keys and 429 mapping**

Add feedback keys under the existing five-segment session scope. Map 429 to a
new `FamilyApiErrorKind` value `RATE_LIMITED`; do not treat it as offline or
transparently replay the individual API request. The client outbox retains the
command and uses the bounded 5-second, 30-second, and 2-minute retry schedule
defined below.

```ts
feedbackList: (session: ClientSession) =>
  [...scope(session), 'feedback-list'] as const,
feedbackDetail: (session: ClientSession, feedbackId: string) =>
  [...scope(session), 'feedback-detail', feedbackId] as const,
```

- [ ] **Step 5: Run client tests, all API-client tests, and typecheck**

Run:

```bash
pnpm exec vitest run packages/api-client/test
pnpm --filter @family/api-client typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the feedback client**

```bash
git add packages/api-client
git commit -m "feat: add feedback api client"
```

---

### Task 7: Add parent diagnostics, persistent submission, and Feedback tab

**Files:**
- Create: `apps/parent/src/features/feedback/feedback-runtime.tsx`
- Create: `apps/parent/src/features/feedback/feedback-queries.ts`
- Create: `apps/parent/src/screens/send-feedback-screen.tsx`
- Create: `apps/parent/app/(tabs)/feedback.tsx`
- Create: `apps/parent/app/feedback/new.tsx`
- Create: `apps/parent/test/feedback-runtime.test.tsx`
- Create: `apps/parent/test/send-feedback-screen.test.tsx`
- Modify: `apps/parent/src/app/app-provider.tsx`
- Modify: `apps/parent/src/auth/use-session.ts`
- Modify: `apps/parent/app/(tabs)/_layout.tsx`
- Modify: `apps/parent/app/_layout.tsx`
- Modify: `apps/parent/jest.config.cjs`

**Interfaces:**
- Produces: `ParentFeedbackProvider`, `useFeedbackRuntime()`, `useRecordFeedbackScreen(screen)`, and `SendFeedbackScreen`.
- Consumes: Task 2 diagnostics/outbox and Task 6 API client.

- [ ] **Step 1: Write failing runtime tests**

Render the provider with memory AsyncStorage, controlled time, deterministic UUIDs, a session that changes from undefined to parent, and a fake API. Assert:

- setup feedback queues without a session;
- the first parent session binds and flushes the unscoped draft;
- an entry scoped to another session is not sent;
- network events are recorded once per state change;
- retry after reconnect removes only acknowledged entries;
- free-form text appears only in the feedback command, never a diagnostic event.

```ts
await runtime.submit({ category: 'BROKEN', description: 'Setup failed.' });
expect(await outbox.list()).toHaveLength(1);
rerender(<Harness session={parentSession} />);
await waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
```

- [ ] **Step 2: Write failing submission-screen tests**

Assert the three exact choices, optional 2,000-character text, accessible selected state, diagnostic summary disclosure, submit-disabled state, queued confirmation, delivered confirmation, and safe cancellation. Verify no GitHub copy or control appears.

```tsx
fireEvent.press(screen.getByRole('button', { name: 'I have an idea' }));
fireEvent.changeText(
  screen.getByLabelText('Tell us more (optional)'),
  'Make the buttons bigger.',
);
fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
expect(await screen.findByText(/feedback was saved/i)).toBeTruthy();
```

- [ ] **Step 3: Run parent tests and confirm failure**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand test/feedback-runtime.test.tsx test/send-feedback-screen.test.tsx
```

Expected: FAIL because the runtime and screen do not exist.

- [ ] **Step 4: Implement the always-mounted parent feedback runtime**

Create one diagnostic buffer per app process using `Platform.OS` to select `PARENT_IOS` or `PARENT_ANDROID` and `Constants.expoConfig?.version ?? 'development'`. Wrap the dependency fetch with `createDiagnosticFetch` before exposing it through `useSession`.

Keep the feedback provider mounted even without a session. Store its outbox under `family-parent-feedback-outbox:v1`. Derive an authenticated scope from normalized API origin, household ID, actor ID, and role. On app start, session appearance, and online transition, flush only unscoped or matching entries through `client.createFeedback`.

Resetting an authenticated scope advances the diagnostic-buffer epoch. Every
diagnostic fetch captures its start epoch and drops a late success, contracted
error, or thrown result after that epoch changes.

```tsx
const diagnosticFetch = useMemo(
  () => createDiagnosticFetch(dependencies.fetch, diagnostics, now),
  [dependencies.fetch, diagnostics, now],
);

return (
  <ParentFeedbackProvider
    session={session}
    fetch={diagnosticFetch}
    storage={dependencies.asyncStorage}
  >
    {session ? (
      <SessionQueryProvider
        session={session}
        asyncStorage={dependencies.asyncStorage}
      >
        {children}
      </SessionQueryProvider>
    ) : (
      children
    )}
  </ParentFeedbackProvider>
);
```

- [ ] **Step 5: Implement the submission screen and navigation**

The screen accepts optional fixed context `{ category, screen }`, renders the three choices, captures the buffer snapshot at submit time, creates one UUID idempotency key, enqueues before attempting delivery, and shows:

- `Thanks - your feedback was saved.` after server acknowledgement;
- `Saved on this phone - it will send when your family server reconnects.` while queued.

Add the fifth tab titled `Feedback` with a speech-bubble text icon. The tab shows
`Send feedback` plus the current-scope queued count and rows with category,
created time, diagnostics yes/no, and an 80-character whitespace-normalized
description preview. A parent can inspect the full local draft and confirm
deletion of one entry. The signed-out setup screen exposes only unbound
device-local drafts, never a prior bound household scope.

Persist delivery as `QUEUED` -> `DELIVERY_ATTEMPTED` before network I/O ->
`DELIVERED_PENDING_CLEANUP` after receipt -> removed. The delivered tombstone
contains no command, description, or diagnostic snapshot. Removal returns an
honest `removedUnsent`, `alreadyDelivered`, `deliveryUnknown`, or `notFound`
result so parent copy cannot mislabel a server-acknowledged report.

```ts
const command = CreateFeedbackCommandSchema.parse({
  idempotencyKey: randomUUID(),
  category,
  description,
  diagnosticSnapshot: diagnostics.snapshot(),
});
await outbox.enqueue(command, currentSessionScope);
await flush();
```

- [ ] **Step 6: Add Jest mappings and provider injection points**

Keep production defaults unchanged, but allow tests to inject `now`, `randomUUID`, platform source, and storage through `ParentAppDependencies`. Do not use module-global mutable diagnostics state.

```ts
export type ParentFeedbackDependencies = {
  now(): Date;
  randomUUID(): string;
  source: Extract<FeedbackSource, 'PARENT_IOS' | 'PARENT_ANDROID'>;
  storage: StringStorage;
};
```

- [ ] **Step 7: Run focused and existing provider/navigation tests**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand test/feedback-runtime.test.tsx test/send-feedback-screen.test.tsx test/session-store.test.ts test/home-screen.test.tsx
pnpm --filter @family/parent typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit parent feedback submission**

```bash
git add apps/parent
git commit -m "feat: add parent feedback submission"
```

---

### Task 8: Add the parent Inbox, redaction review, and maintainer handoff

**Files:**
- Create: `apps/parent/src/features/feedback/maintainer-settings.ts`
- Create: `apps/parent/src/features/feedback/highlighted-private-text.tsx`
- Create: `apps/parent/src/screens/feedback-inbox-screen.tsx`
- Create: `apps/parent/src/screens/feedback-detail-screen.tsx`
- Create: `apps/parent/src/screens/feedback-export-screen.tsx`
- Create: `apps/parent/app/feedback/[feedbackId].tsx`
- Create: `apps/parent/app/feedback/export/[feedbackId].tsx`
- Create: `apps/parent/test/feedback-inbox-screen.test.tsx`
- Create: `apps/parent/test/feedback-detail-screen.test.tsx`
- Create: `apps/parent/test/feedback-export-screen.test.tsx`
- Modify: `apps/parent/src/features/feedback/feedback-queries.ts`
- Modify: `apps/parent/app/(tabs)/feedback.tsx`
- Modify: `apps/parent/src/query/create-query-client.ts`
- Modify: `apps/parent/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: shared parent Feedback Inbox, review/editor, privacy highlights, device-local maintainer setting, and browser/clipboard export.
- Consumes: Tasks 2, 5, 6, and 7.

- [ ] **Step 1: Add the compatible clipboard dependency**

Run: `pnpm --filter @family/parent exec expo install expo-clipboard`

Expected: Expo selects the SDK 57-compatible package and updates only the parent manifest and lockfile. Inspect the lockfile to confirm it resolves from public npm.

- [ ] **Step 2: Write failing Inbox and review tests**

Assert newest-first rows show category, source/platform, time, status, preview, and diagnostics indicator. Assert stale cached list copy appears while a refresh fails. In detail, assert either parent can edit, remove one diagnostic event, remove all diagnostics, change status, save a public URL, and delete after confirmation.

Pass privacy findings with exact offsets and assert highlighted spans have both visible warning styling and screen-reader labels such as `Possible family name`.

```tsx
expect(await screen.findByText('Something broke')).toBeTruthy();
expect(screen.getByLabelText('Possible family name')).toBeTruthy();
```

- [ ] **Step 3: Write failing maintainer/export tests**

Assert maintainer mode defaults off in a fresh device store. With mode off, detail has no GitHub action. With mode on, `Prepare public issue` appears. Assert:

- every title/description edit clears the prior validated preview;
- copy/open remain disabled until the new preview returns;
- URL handoff calls `Linking.openURL` and then marks the report `EXPORTED`;
- clipboard fallback calls `Clipboard.setStringAsync` and opens the blank composer;
- open failure keeps Markdown visible and does not mark the report exported;
- the UI says `Opened GitHub` rather than `Published`.

```tsx
fireEvent.press(screen.getByRole('button', { name: 'Continue to GitHub' }));
await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
expect(markExported).toHaveBeenCalledTimes(1);
expect(screen.queryByText(/published/i)).toBeNull();
```

- [ ] **Step 4: Run focused parent tests and confirm failure**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand test/feedback-inbox-screen.test.tsx test/feedback-detail-screen.test.tsx test/feedback-export-screen.test.tsx
```

Expected: FAIL because the Inbox/review/export screens do not exist.

- [ ] **Step 5: Implement feedback queries and the shared Inbox**

Add query options for list/detail and mutations that invalidate both keys after create/update/delete. Persist only the feedback list query, not full diagnostic detail, by extending `isPersistableRead` for `familyQueryKeys.feedbackList(session)`.

```ts
export function feedbackListQueryOptions(
  session: ClientSession,
  fetchImpl: typeof fetch,
) {
  const client = createFamilyApiClient({
    apiOrigin: session.apiOrigin,
    accessToken: session.accessToken,
    fetch: fetchImpl,
  });
  return queryOptions({
    queryKey: familyQueryKeys.feedbackList(session),
    queryFn: () => client.listFeedback(),
  });
}
```

The Feedback tab renders `Send feedback`, pending outbox count, and `FeedbackInboxScreen`. Offline refresh keeps the last list and labels it `Saved feedback - reconnect to refresh`.

- [ ] **Step 6: Implement review and accessible findings**

Render title/description from controlled state. Use `privacyFindings` to split strings into ordered plain and warning spans; overlapping spans merge before rendering. Removing one diagnostic event sends an updated strict `diagnosticEvents` array. Removing all sends an empty array. The server preserves the report's immutable source, version, and current-screen metadata. Every save uses a new UUID idempotency key.

```ts
await client.updateFeedback(report.id, {
  idempotencyKey: randomUUID(),
  title,
  description,
  diagnosticEvents: keptEvents,
  status,
});
```

- [ ] **Step 7: Implement device-local maintainer mode and export**

Store one boolean at `family-parent-maintainer-tools:v1` in AsyncStorage. Put its toggle under an `Advanced` disclosure in the Feedback tab so ordinary submission never mentions GitHub.

On export, call `prepareFeedbackPublicPreview` with the current public fields. Any edit sets `validatedPreview` to undefined. Use Task 2's handoff builder, Expo Clipboard, and `Linking.openURL`. After a successful browser open, patch status to `EXPORTED`; never infer issue creation.

```ts
const handoff = buildGithubIssueHandoff(validatedPreview);
if (handoff.kind === 'URL') {
  await Linking.openURL(handoff.url);
} else {
  await Clipboard.setStringAsync(handoff.markdown);
  await Linking.openURL(handoff.issueComposerUrl);
}
await markExported();
```

- [ ] **Step 8: Run parent feedback and persistence suites**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand test/feedback-inbox-screen.test.tsx test/feedback-detail-screen.test.tsx test/feedback-export-screen.test.tsx test/query-client.test.ts
pnpm --filter @family/parent typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit parent review and handoff**

```bash
git add apps/parent pnpm-lock.yaml
git commit -m "feat: add parent feedback review and export"
```

---

### Task 9: Add child-friendly kitchen feedback and offline delivery

**Files:**
- Create: `apps/dashboard/src/components/tell-us-button.tsx`
- Create: `apps/dashboard/src/screens/feedback-screen.tsx`
- Create: `apps/dashboard/test/feedback-screen.test.tsx`
- Create: `apps/dashboard/test/feedback-outbox.test.tsx`
- Modify: `apps/dashboard/src/app.tsx`
- Modify: `apps/dashboard/src/screens/family-home-screen.tsx`
- Modify: `apps/dashboard/src/styles.css`
- Modify: `apps/dashboard/vite.config.ts`
- Modify: `apps/dashboard/src/vite-env.d.ts`
- Modify: `apps/dashboard/test/app.test.tsx`

**Interfaces:**
- Produces: dashboard feedback overlay and persistent `Tell us` action.
- Consumes: Task 2 outbox/diagnostics and Task 6 `createFeedback` client method.

- [ ] **Step 1: Write failing dashboard screen tests**

Assert three large buttons with exact labels `Something broke`, `This is confusing`, and `I have an idea`; optional text; keyboard-safe focus; submit without text; accessible selected states; `Back`; and the success copy. Assert no report list, edit, delete, maintainer, GitHub, or export control exists.

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Something broke' }));
fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
expect(await screen.findByText(/feedback was saved/i)).toBeVisible();
expect(screen.queryByText(/github|export|inbox/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Write failing dashboard runtime/outbox tests**

Render `App` with memory IndexedDB storage and assert:

- feedback queues before dashboard setup and flushes after credential import;
- offline feedback survives remount;
- online/visibility change retries once;
- a 429 response keeps the report queued with a calm `We'll try again later` message and no rapid retry loop;
- an undelivered item older than 30 days is removed;
- the persistent `Tell us` action opens and returns to the prior route.

```ts
await outbox.enqueue(command, undefined);
unmount();
sessionStore.load.mockResolvedValue(dashboardSession);
render(<App sessionStore={sessionStore} queryStorage={storage} fetch={fetch} />);
await waitFor(() =>
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: '/v1/feedback' }),
    expect.objectContaining({ method: 'POST' }),
  ),
);
expect(await outbox.list()).toEqual([]);
```

- [ ] **Step 3: Run focused dashboard tests and confirm failure**

Run:

```bash
pnpm --filter @family/dashboard test -- feedback-screen.test.tsx feedback-outbox.test.tsx
```

Expected: FAIL because dashboard feedback UI/runtime do not exist.

- [ ] **Step 4: Add the dashboard diagnostic runtime and outbox**

Define `__FAMILY_APP_VERSION__` in Vite from
`process.env.FAMILY_APP_VERSION ?? 'development'`, declare it as a string in
`vite-env.d.ts`, and use it for one `DASHBOARD` buffer. Wrap `fetchImpl` once.
Store the outbox in the existing IndexedDB boundary under
`family-dashboard-feedback-outbox:v1` with `expiresAfterMs` set to 30 days.

```ts
const outbox = createFeedbackOutbox({
  storage: queryStorage,
  key: 'family-dashboard-feedback-outbox:v1',
  expiresAfterMs: 30 * 24 * 60 * 60 * 1_000,
  now,
});
const diagnosticFetch = createDiagnosticFetch(fetchImpl, diagnostics, now);
```

Like the parent runtime, bind pre-setup entries to the first valid dashboard
session and never flush entries bound to another session scope. While online,
retry eligible transport/5xx/429 failures after 5 seconds, 30 seconds, and 2
minutes, then stop. Session, online, visibility, and manual triggers accelerate
and coalesce; success, offline, scope change, and unmount reset or cancel the
timer and late generations cannot deliver across scope.

The dashboard uses the same durable delivery-state protocol. A retry after an
ambiguous acknowledgement reuses the original idempotency key, and a persisted
delivered tombstone is cleaned without another network call.

- [ ] **Step 5: Add the root dashboard feedback overlay and persistent action**

Keep feedback overlay state at the top-level `App`, above the session/setup branch. Render `TellUsButton` alongside whichever setup or authenticated content is active, pass `onOpenFeedback` into `DashboardFlow`, and overlay `FeedbackScreen` without replacing `DashboardRoute`. Closing the overlay reveals the exact prior screen. Hide the button only while the overlay is open.

```tsx
return (
  <>
    {applicationContent}
    {feedbackOpen ? (
      <FeedbackScreen onClose={() => setFeedbackOpen(false)} onSubmit={submit} />
    ) : (
      <TellUsButton onPress={() => setFeedbackOpen(true)} />
    )}
  </>
);
```

The submit handler enqueues before delivery, snapshots diagnostics once, applies a 30-second local success cooldown, and closes the overlay after acknowledgement.

- [ ] **Step 6: Style for the Raspberry Pi touchscreen**

Use the existing design tokens and dashboard minimum touch size. Give each category a picture plus text, preserve color-independent selected state, keep text optional, and respect reduced-motion CSS media queries.

```css
.feedback-choice {
  min-width: 12rem;
  min-height: 7rem;
  border: 3px solid transparent;
}
.feedback-choice[aria-pressed='true'] {
  border-color: #155eef;
  outline: 3px solid currentColor;
}
@media (prefers-reduced-motion: reduce) {
  .feedback-overlay { transition: none; }
}
```

- [ ] **Step 7: Run dashboard feedback, app, and PWA tests**

Run:

```bash
pnpm --filter @family/dashboard test -- feedback-screen.test.tsx feedback-outbox.test.tsx app.test.tsx pwa-config.test.ts
pnpm --filter @family/dashboard typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit kitchen feedback**

```bash
git add apps/dashboard
git commit -m "feat: add kitchen feedback submission"
```

---

### Task 10: Connect contextual error reporting and screen diagnostics

**Files:**
- Modify: `apps/parent/src/components/screen-state.tsx`
- Modify: `apps/parent/src/screens/home-screen.tsx`
- Modify: `apps/parent/src/screens/approvals-screen.tsx`
- Modify: `apps/parent/src/screens/approval-detail-screen.tsx`
- Modify: `apps/parent/src/screens/chores-screen.tsx`
- Modify: `apps/parent/src/screens/rewards-screen.tsx`
- Modify: `apps/parent/src/screens/setup-screen.tsx`
- Modify: corresponding parent route files under `apps/parent/app/`
- Modify: `apps/dashboard/src/components/confirm-action.tsx`
- Modify: `apps/dashboard/src/screens/family-home-screen.tsx`
- Modify: `apps/dashboard/src/screens/chore-detail-screen.tsx`
- Modify: `apps/dashboard/src/screens/active-chore-screen.tsx`
- Modify: `apps/dashboard/src/screens/setup-screen.tsx`
- Modify: `apps/dashboard/src/app.tsx`
- Create: `apps/parent/test/contextual-feedback.test.tsx`
- Create: `apps/dashboard/test/contextual-feedback.test.tsx`

**Interfaces:**
- Produces: fixed-context `Report this problem` actions and screen/network diagnostic events across authenticated and setup flows.
- Consumes: Tasks 7 and 9 feedback runtimes.

- [ ] **Step 1: Write failing contextual-report tests**

For each parent read-failure state and each dashboard snapshot/chore failure, activate `Report this problem` and assert the feedback draft receives only `{ category: 'BROKEN', screen: <fixed enum> }`. Assert raw error messages, form values, chore names, child names, and failed request bodies are absent from diagnostic events.

Assert setup-screen feedback queues without credentials and flushes only after a valid session is imported.

```tsx
fireEvent.press(screen.getByRole('button', { name: 'Report this problem' }));
expect(openDraft).toHaveBeenCalledWith({
  category: 'BROKEN',
  screen: 'SETUP',
});
expect(JSON.stringify(diagnostics.snapshot())).not.toContain(rawError.message);
```

- [ ] **Step 2: Run focused contextual tests and confirm failure**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand test/contextual-feedback.test.tsx
pnpm --filter @family/dashboard test -- contextual-feedback.test.tsx
```

Expected: FAIL because the report actions are absent.

- [ ] **Step 3: Add reusable fixed-context actions**

Extend parent `ScreenState` with optional `actionLabel` and `onAction`. Extend dashboard `ConfirmAction` with optional `onReportProblem`. The action calls the feedback runtime with an enum screen and `BROKEN`; it never accepts an `Error` object or arbitrary metadata.

```ts
type ReportProblemContext = {
  category: 'BROKEN';
  screen: FeedbackScreen;
};

function reportProblem(context: ReportProblemContext): void {
  setContextualDraft(context);
  openFeedback();
}
```

- [ ] **Step 4: Record fixed screen and network events**

Call `useRecordFeedbackScreen` once from each parent route. In dashboard `DashboardFlow`, record the enum corresponding to route changes. Subscribe once to the existing online managers and record only actual state transitions.

- [ ] **Step 5: Wire every current relevant failure state**

Cover parent home, approvals list/detail, chores, rewards/ledger, and setup. Cover dashboard initial snapshot, claim, completion, and setup failures. Do not add report actions to normal validation hints such as an empty required field; add them only when storage, network, server, or an unexpected operation fails.

```tsx
<ScreenState
  message="Approval inbox could not be loaded."
  actionLabel="Report this problem"
  onAction={() =>
    reportProblem({ category: 'BROKEN', screen: 'PARENT_APPROVALS' })
  }
/>
```

- [ ] **Step 6: Run all parent and dashboard suites**

Run:

```bash
pnpm --filter @family/parent test -- --runInBand
pnpm --filter @family/dashboard test
pnpm --filter @family/parent typecheck
pnpm --filter @family/dashboard typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit contextual reporting**

```bash
git add apps/parent apps/dashboard
git commit -m "feat: connect contextual feedback reporting"
```

---

### Task 11: Add cross-client acceptance, issue template, security gates, and docs

**Files:**
- Create: `e2e/dashboard-feedback-flow.spec.ts`
- Create: `apps/parent/test/feedback-native-acceptance.test.tsx`
- Create: `.github/ISSUE_TEMPLATE/app-feedback.md`
- Create: `scripts/verify-no-github-credentials.mjs`
- Create: `scripts/test-verify-no-github-credentials.mjs`
- Modify: `scripts/verify-production-bundles.sh`
- Modify: `playwright.config.ts`
- Modify: `apps/dashboard/vite.config.ts`
- Modify: `apps/api/README.md`
- Modify: `docs/development/client-vertical-slice.md`
- Modify: `package.json`

**Interfaces:**
- Produces: parameterized iOS/Android native component acceptance, a repeatable
  browser/API cross-client journey, and release security checks.
- Consumes: all prior tasks.

- [ ] **Step 1: Write the failing Playwright feedback journey**

From the dashboard browser, open `Tell us`, choose `Something broke`, enter a hostile description containing fixture names, a LAN IP, email, UUID, and Markdown URL, then submit. Use the built parent API client with the parent fixture session to:

1. list and find the report;
2. update it to `REVIEWING` with a scrubbed description;
3. request a public preview;
4. assert forbidden fixture values are absent;
5. use `buildGithubIssueHandoff` and assert the decoded issue body equals the preview;
6. delete the local report.

Do not navigate to GitHub or create an issue.

```ts
await page.getByRole('button', { name: 'Tell us' }).click();
await page.getByRole('button', { name: 'Something broke' }).click();
await page.getByLabel('Tell us more (optional)').fill(hostileDescription);
await page.getByRole('button', { name: 'Send feedback' }).click();

const report = (await parentClient.listFeedback()).find(
  ({ category }) => category === 'BROKEN',
)!;
const preview = await parentClient.prepareFeedbackPublicPreview(report.id, {
  publicTitle: 'Kitchen feedback',
  publicDescription: 'The feedback control stopped responding.',
  includeDiagnostics: true,
});
expect(preview.body).not.toContain('192.168.1.20');
```

- [ ] **Step 2: Add the E2E repository configuration and confirm failure**

Set `FAMILY_FEEDBACK_GITHUB_REPOSITORY=family-tests/family-app` only in Playwright's local API environment. Run: `pnpm test:e2e`

```ts
const serverEnvironment = {
  ...inheritedEnvironment,
  FAMILY_FEEDBACK_GITHUB_REPOSITORY: 'family-tests/family-app',
};
```

Expected before final wiring: FAIL in the new feedback journey.

- [ ] **Step 3: Add the public fallback issue template**

Create a template with frontmatter `name: App feedback`, `about: Sanitized feedback prepared by the local Family app`, and default `feedback` label. Its body must remind maintainers not to paste names, calendar content, balances, credentials, public/local addresses, or raw logs.

```markdown
---
name: App feedback
about: Sanitized feedback prepared by the local Family app
labels: feedback
---

<!-- Review this public issue for private family or network information. -->
```

- [ ] **Step 4: Add a GitHub credential scanner with adversarial tests**

The scanner checks tracked source and built parent/dashboard artifacts for GitHub credential prefixes assembled from string fragments so the scanner does not match itself. Cover classic PAT, fine-grained PAT, OAuth, user-to-server, refresh, and GitHub App token prefixes. Its test creates an owner-only temporary fixture directory, proves each token shape fails, proves ordinary repository URLs pass, and cleans up through signal-safe traps.

```js
const forbiddenPrefixes = [
  ['gh', 'p_'].join(''),
  ['github', '_pat_'].join(''),
  ['gh', 'o_'].join(''),
  ['gh', 'u_'].join(''),
  ['gh', 'r_'].join(''),
  ['gh', 's_'].join(''),
];
```

Add `verify:no-github-credentials` to root scripts and invoke it from `verify-production-bundles.sh` after the existing credential scan.

- [ ] **Step 5: Remove family-specific PWA metadata**

Change the dashboard manifest description from a named-family phrase to `A private family kitchen dashboard`. Keep runtime household names server-provided and out of generated build assets.

```ts
manifest: {
  name: 'Family Kitchen',
  short_name: 'Family Kitchen',
  description: 'A private family kitchen dashboard',
}
```

- [ ] **Step 6: Document local configuration and privacy behavior**

Document:

```bash
export FAMILY_FEEDBACK_GITHUB_REPOSITORY='owner/repository'
```

Explain that the value is public metadata, no GitHub token is used, reports remain local until parent review, GitHub requires the maintainer's browser login, `EXPORTED` does not prove publication, and feedback cannot repair a currently unreachable server until reconnection. Retain the existing LAN-only warning.

- [ ] **Step 7: Run the focused security and E2E checks**

Run:

```bash
node scripts/test-verify-no-github-credentials.mjs
pnpm test:e2e
pnpm verify:production-bundles
```

Expected: PASS with no GitHub navigation and no credential or development-token leakage.

- [ ] **Step 8: Run the full release gate**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm format:check
pnpm --filter @family/api exec drizzle-kit check --config drizzle.config.ts
```

Expected: all tests, builds, lint, formatting, and migration validation pass.

- [ ] **Step 9: Commit the completed feedback loop**

```bash
git add .github e2e scripts apps/dashboard/vite.config.ts apps/api/README.md docs/development package.json playwright.config.ts
git commit -m "test: verify family feedback loop"
```

---

## Final acceptance checklist

- [ ] Parameterized React Native/Jest component acceptance exercises the shared
      parent submission, Inbox, review, and export components for iOS and Android
      with distinct source/platform metadata and injected Clipboard/Linking
      boundaries. This is not simulator or real-device E2E.
- [ ] Kitchen feedback requires no name and exposes no Inbox or GitHub concept.
- [ ] Both parents can review/edit/delete local feedback; maintainer mode affects only one device's UI.
- [ ] Setup feedback can queue before credentials and binds only to the first valid local session scope.
- [ ] Diagnostics never accept arbitrary log text or user/domain data.
- [ ] Dashboard rate limiting and both offline outboxes behave deterministically.
- [ ] Every public edit invalidates the prior preview and requires server sanitization again.
- [ ] GitHub export uses browser authentication and stores no GitHub credential.
- [ ] Closed-report retention and dashboard outbox expiry use the approved 30-day rules.
- [ ] Playwright/API cross-client E2E verifies the
      dashboard-to-parent-to-public-preview flow without publishing.
- [ ] Full release, migration, public-registry, and credential-leak gates pass.
