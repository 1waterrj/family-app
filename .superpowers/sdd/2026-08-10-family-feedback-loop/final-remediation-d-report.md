# Final remediation D report

Date: 2026-08-12
Branch: `codex/feedback-loop`
Starting revision: `64bad25`
Initial remediation revision: `25e4f4b`

## Initial remediation outcome

The initial remediation replaced insecure client UUID fallbacks with one
injectable secure UUID-v4 generator, hardened privacy scanning against
invisible/control/entity/HTML/Markdown evasions while preserving UTF-16 source
offsets, and changed feedback delivery to short storage-lock transitions around
network I/O with an attempt-generation compare-and-swap.

No company infrastructure, automatic GitHub submission, public webhook,
public reverse proxy, port forwarding, or other public ingress was added.

### Secure client UUID generation

- `createSecureUuid` uses `crypto.randomUUID()` when present, otherwise fills
  16 bytes with `crypto.getRandomValues()`, sets the RFC 4122 version-4 and
  variant bits, and emits lowercase canonical UUID text.
- A runtime with neither secure source throws a clear error. There is no
  `Math.random` fallback.
- Dashboard feedback and chore operations, the shared feedback outbox, and all
  audited parent operation paths use the shared generator. Dashboard feedback
  resources and the outbox accept deterministic UUID injection.
- The constrained-browser regression removes `crypto.randomUUID` while keeping
  `getRandomValues`, submits through the real dashboard UI, and verifies a
  durable command with a UUID-v4 idempotency key.

Initial RED evidence showed the module missing, outbox injection ignored, and
dashboard LAN-origin submission unable to persist. The focused UUID/outbox/
dashboard slice then passed 31/31.

### Initial privacy hardening

The scanner constructed a canonical view plus per-UTF-16-unit source mapping,
decoded numeric and selected named entities, removed invisible controls,
comments, raw tags, and known hidden blocks, and rescanned neutralized public
Markdown. Tests covered zero-width/comment-split fictional names, numeric entity links and
email, fullwidth text, bidi controls, credentials, hidden/script HTML, exact
offsets after emoji, and preservation of `👨‍👩‍👧 Café 家族`.

Initial canonicalization tests failed 2/15. A subsequent hidden-content audit
failed 1/15 before whole hidden-element removal. The initial final privacy slice
passed 15/15.

### Initial non-blocking outbox protocol

The persisted transition became:

`QUEUED` -> `DELIVERY_ATTEMPTED(attempt UUID)` -> network outside lock ->
compare-and-swap -> `DELIVERED_PENDING_CLEANUP` -> removed.

Preparation, attempt claiming, rejection cleanup, acknowledgement finalization,
and explicit removal use only short storage/key critical sections. Finalization
requires the same entry, scope, state, and attempt UUID. Concurrent removal
invalidates the attempt so a late ACK or rejection cannot recreate private
content or consume another scope's command. Durable attempted entries remain
retryable after reload with the original idempotency key.

The initial outbox regressions had five expected failures. The initial focused
outbox suite passed 19/19 and covered old-scope non-blocking operations,
same-adapter single delivery, concurrent deletion with late ACK/rejection,
scope isolation, tombstones, migration, expiry, and retry recovery.

### Initial final verification (Node 24.19.0)

- Full test: **48 Vitest files / 524 tests** and **17 parent suites / 146
  tests** passed with Colima/Testcontainers.
- Typecheck, lint, format check, production build, `git diff --check`, and
  Drizzle schema check passed.
- Playwright migration/seed/artifact workflow: **2/2 tests** passed.
- iOS, Android, and dashboard production bundle credential scans passed.
- GitHub scanner self-test: **7 scenarios**; artifact verifier self-test:
  **14 scenarios**; direct Chromium artifact probe passed.

## Review round 1 findings

Independent review found five remaining adversarial gaps:

1. NFKC was applied one code point at a time, so adjacent combining sequences
   and Hangul Jamo did not compose to the canonical known term.
2. The selected named-entity table omitted valid invisible HTML entities such
   as `&zwj;` and `&NegativeThinSpace;`.
3. Hidden-element logic depended on a narrow CSS/attribute allowlist; comment-
   obfuscated display, opacity, collapsed details, and other raw elements could
   have their tags stripped while their contents became public.
4. An active entry used `break`, starving every later command in the same scope.
5. Coordination was keyed by adapter object identity, so distinct adapters over
   one durable store/key could claim and deliver the same entry concurrently.

## Review round 1 remediation

### Sequence-aware canonicalization and complete entities

NFKC now applies to each complete Unicode grapheme sequence through
`Intl.Segmenter`. Every normalized UTF-16 unit maps to the full original
grapheme span, so composition (`Pé` -> `Pé`, `가` -> `가`) and compatibility
expansion (`ﬀ` -> `ff`) retain useful source highlights.

Entity handling now uses the standards-complete `entities` HTML decoder in
strict semicolon mode. Named and numeric joiners decode before invisible-control
removal and matching, with the entire entity source range retained. Public
output tests interpret the entity variants again and prove no visually
equivalent prohibited name survives. Emoji joiners needed for `👨‍👩‍👧`, non-Latin text,
and ordinary composed text remain intact.

### Fail-closed raw HTML

Public canonicalization uses parse5 source locations to remove every parsed raw
HTML element/comment with all of its contents, independent of CSS visibility.
A conservative residual tokenizer removes context-invalid or malformed opening
elements through their matching close or end of input. This covers mixed case,
nested elements, `style="display:/**/none"`, `opacity:0`, collapsed `details`,
`aria-hidden`, and unclosed raw elements without trying to interpret CSS.
Ordinary Markdown is escaped and ordinary emoji/non-Latin text stays public.

### Fair, stable live-runtime outbox coordination

All live outboxes with the same durable storage key now share one module-global
coordinator, even when separate adapter objects wrap the same backing store.
Coordination is conservative across unrelated backends that reuse a key.
Different keys retain independent locks. Encountering an active earlier entry
now skips it and continues claiming later eligible entries, so a hung command
cannot starve its same-scope successors.

The delivery promise remains outside the storage lock. Rejection and removal
clear only the matching active generation; ACK finalization retains the full
entry/scope/state/attempt CAS. A true process reload is now tested with a fresh
module instance rather than incorrectly treating a new adapter as a restart.

This single-delivery registry covers one JavaScript runtime. It cannot coordinate
separate browser tabs or processes; the durable idempotency key remains the
cross-runtime protection. The dashboard normally uses one page runtime.

## Review round 1 RED/GREEN evidence

- Privacy RED: **7 failures / 24 tests** for combining composition, Jamo,
  public sequence redaction, two named invisible entities, post-render entity
  safety, and conservative raw-element removal.
- Outbox RED: **2 failures / 23 tests** for same-scope ACTIVE starvation and
  distinct-adapter double delivery. Independent-key and rejection-cleanup
  controls already passed.
- Privacy GREEN: **24/24**.
- API-client outbox GREEN: **23/23**.
- Combined privacy/outbox/dashboard slice: **3 files / 62 tests** passed.
- Parent queue/runtime slice: **2 suites / 31 tests** passed.

## Review round 1 final verification (Node 24.19.0)

- Full `pnpm test` with Colima/Testcontainers: clean-build safety checks;
  **48 Vitest files / 537 tests** and **17 parent suites / 146 tests** passed.
- `pnpm typecheck`: all seven applicable workspace projects passed.
- `pnpm lint`, `pnpm format:check`, `pnpm build`, and `git diff --check` passed.
- `pnpm test:e2e`: migration, development seed, artifact security, and **2/2
  Playwright tests** passed.
- `pnpm verify:production-bundles`: iOS, Android, and dashboard bundle scans
  found no development credential markers, access tokens, or GitHub credentials.
- GitHub credential scanner and self-test (**7 scenarios**), E2E artifact
  verifier and self-test (**14 scenarios**), and direct Chromium artifact probe
  passed.
- Drizzle schema check passed (`Everything's fine`).

## Operational boundaries

The client vertical-slice guide documents plain-LAN UUID behavior, sequence/
entity/raw-HTML privacy handling, same-scope fairness, stable per-key runtime
coordination, and the cross-tab/process limitation.

A transport promise may remain pending when the transport supplies no timeout
or abort signal, but it owns no storage lock and can be locally removed without
resurrection. After a real process restart, a durable attempted entry is
intentionally retried with the original idempotency key.
