# Feedback Loop Final Remediation A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while executing each task inline. The assigning agent requires one final remediation commit, so do not commit between tasks.

**Goal:** Close the reviewed feedback-loop server/data-integrity/privacy gaps without adding public ingress or changing the private-first architecture.

**Architecture:** Keep `updatedAt` as the report revision and enforce compare-and-swap in the repository's household-scoped `UPDATE`. Centralize exact report-linked `UPDATE_FEEDBACK` replay deletion and call it from retention and explicit deletion transactions. Extend the shared Zod/SQL admission boundary in lockstep, upgrade existing rows privacy-safely in migration `0012`, and carry the canonical revision through both parent mutation flows.

**Tech Stack:** TypeScript 6, Zod, Fastify, Drizzle/PostgreSQL 17, React Native/TanStack Query, Vitest/Jest, pnpm on Node 24.

## Global Constraints

- Work only in `.worktrees/feedback-loop` on `codex/feedback-loop` after `fa3f166`.
- Write a failing regression and observe the intended failure before every production change.
- Preserve household isolation and return a structured `CONFLICT` for stale or missing update revisions without revealing existence.
- Preserve accepted idempotent replay responses; purge only exact household/report `UPDATE_FEEDBACK` responses when deleting the report.
- Keep migration/runtime SQL validation exactly aligned with the contract and safely repair rows legal before migration `0012`.
- Use public package registries and personal/local infrastructure only. Do not
  use company accounts, credentials, registries, cloud resources, or network
  services for this project, and do not add public ingress.
- Produce one remediation commit and the assigned final report.

---

### Task 1: Exact replay cleanup on explicit deletion

**Files:**
- Modify: `apps/api/test/feedback.test.ts`
- Modify: `apps/api/test/feedback-retention.test.ts`
- Modify: `apps/api/src/feedback/repository.ts`
- Modify: `apps/api/src/feedback/service.ts`
- Modify: `apps/api/src/workers/feedback-retention.ts`

**Interfaces:**
- Produce repository helper `deleteUpdateReplaysForReports(transaction, links)` where links are exact household/report pairs.
- Reuse the helper inside the same transactions as explicit and retention deletion.

- [ ] Add an API regression that creates and updates a report, explicitly deletes it, proves the prior update key no longer replays, and proves create/delete/unrelated/cross-household rows survive.
- [ ] Run the focused API test and observe the stale update replay still returning its private response.
- [ ] Extract retention's exact-link predicate into the repository and invoke it immediately before explicit report deletion.
- [ ] Run explicit-delete and retention regressions green.

### Task 2: Parent update optimistic concurrency and lifecycle stability

**Files:**
- Modify: `packages/contracts/test/feedback.test.ts`
- Modify: `packages/contracts/src/feedback.ts`
- Modify: `packages/api-client/test/feedback-client.test.ts`
- Modify: `apps/api/test/feedback.test.ts`
- Modify: `apps/api/src/feedback/repository.ts`
- Modify: `apps/api/src/feedback/service.ts`
- Modify: `apps/api/src/app.ts` only if structured error mapping needs extension
- Modify: `apps/parent/test/feedback-detail-screen.test.tsx`
- Modify: `apps/parent/test/feedback-export-screen.test.tsx`
- Modify: `apps/parent/src/screens/feedback-detail-screen.tsx`
- Modify: `apps/parent/src/screens/feedback-export-screen.tsx`

**Interfaces:**
- Add required ISO `expectedUpdatedAt` to strict `UpdateFeedbackCommand`.
- Change repository update to `WHERE household_id = ? AND id = ? AND updated_at = ?`.
- Return `FeedbackServiceError('CONFLICT', ...)` for a failed compare-and-swap after a preloaded same-household row, using the same response when the row vanished or changed.

- [ ] Add contract/client regressions proving the revision is required and serialized in the PATCH body while idempotency remains header-only.
- [ ] Add a real API concurrency regression: two parents read one revision, the first scrub succeeds, the second receives HTTP 409 `CONFLICT`, the scrub survives, and replaying the accepted key returns its original report.
- [ ] Add lifecycle regressions proving edits to already `CLOSED`/`EXPORTED` reports retain terminal timestamps and closed retention age.
- [ ] Run the new regressions and observe missing validation, stale overwrite, and timestamp postponement failures.
- [ ] Implement the contract, CAS predicate/error, status-transition-only terminal timestamp updates, and accepted-key replay semantics.
- [ ] Update detail save and export status mutations to send the currently adopted report revision; add conflict copy that directs later refresh/rebase instead of silently retrying.
- [ ] Run API/client/parent concurrency and lifecycle regressions green.

### Task 3: Snapshot admission parity and upgrade-safe migration

**Files:**
- Modify: `packages/contracts/test/feedback.test.ts`
- Modify: `packages/contracts/src/feedback.ts`
- Modify: `apps/api/test/schema.test.ts`
- Modify: `apps/api/test/feedback-migration.test.ts`
- Create: `db/migrations/0012_bound-feedback-diagnostics.sql`
- Create: `db/migrations/meta/0012_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`
- Modify: `apps/api/src/db/schema.ts` only if the declarative snapshot requires it

**Interfaces:**
- Export/use one conservative app-version schema accepting `development` and semver/build-like tokens, maximum 160 characters, with no whitespace/control, URLs, credentials, or prose.
- Require nonempty event snapshots to have `max(at) - min(at) <= 900000 ms`; empty/one-event snapshots remain valid.

- [ ] Add literal table-driven contract regressions for accepted current versions and rejected hostile versions, plus inclusive/exclusive 15-minute event spans.
- [ ] Add PostgreSQL parity cases with the same literals and a migration fixture containing pre-0012 legal unsafe version/span rows.
- [ ] Run contract/schema/migration tests and observe parity/admission failures.
- [ ] Add the Zod refinements and replace the SQL validator in `0012`; repair invalid legacy versions to `development`, synchronize JSON metadata, and drop legacy event arrays whose span is too wide before installing the new check.
- [ ] Run migration check plus contract/schema/migration parity green.

### Task 4: Device-name privacy terms and safe version metadata

**Files:**
- Modify: `apps/api/test/feedback-privacy.test.ts`
- Modify: `apps/api/test/feedback.test.ts`
- Modify: `apps/api/src/feedback/repository.ts`
- Modify: `apps/api/src/feedback/privacy.ts`

**Interfaces:**
- Include household dashboard-device names in `listKnownPrivateTerms`.
- Render validated `report.appVersion` through fixed Markdown construction, never from unvalidated user text.

- [ ] Add a real API regression proving a dashboard device name becomes a privacy finding and is scrubbed from public preview.
- [ ] Add privacy regressions proving safe app version metadata appears and hostile invalid versions cannot create Markdown output.
- [ ] Run focused privacy/API tests and observe missing device redaction/version metadata.
- [ ] Add dashboard device lookup and fixed-label version rendering after validating the report metadata with the same safe grammar.
- [ ] Run privacy/API regressions green.

### Task 5: Verification, report, and single commit

**Files:**
- Create: `.superpowers/sdd/2026-08-10-family-feedback-loop/final-remediation-a-report.md`
- Modify: only files above plus formatter changes required by those files.

- [x] Run focused contracts, API, migration, client, detail, export, and retention suites.
- [x] Run full affected package suites, root typecheck, lint, format check, migration check, credential scan, and diff/status review using Node 24 and approved Colima.
- [x] Record exact RED/GREEN evidence, CAS/migration reasoning, commands/results, and concerns in the assigned report.
- [x] Review every requirement against the diff and rerun any proof invalidated by final formatting.
- [x] Create one commit named `fix: close feedback integrity gaps` and verify the committed worktree state.
