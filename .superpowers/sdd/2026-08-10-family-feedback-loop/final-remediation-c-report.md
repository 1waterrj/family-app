# Final remediation C report

Date: 2026-08-12
Branch: `codex/feedback-loop`
Starting revision: `95f3033`

## Outcome

The final export semantics and native parent acceptance findings are remediated.
`EXPORTED` now records either a successful validated Markdown copy or a
successful issue-composer open. It never claims GitHub publication. The parent
suite now has one parameterized React Native component-acceptance journey for
each of `PARENT_IOS` and `PARENT_ANDROID`, while the existing Playwright/API
cross-client journey remains in place.

No company infrastructure, GitHub API/token path, automatic issue creation,
public webhook, public reverse proxy, port forwarding, or other public ingress
was added.

## Export timeline and failure semantics

- Standalone `Copy Markdown` writes the complete validated title/body before it
  sends the local `EXPORTED` update.
- Clipboard `false` or a thrown clipboard error leaves the report unchanged,
  retains the exact preview, and shows a copy failure.
- A successful copy or browser open creates one pending status command containing
  its immutable idempotency key, reviewed `expectedUpdatedAt`, and handoff kind.
  Transport retry reuses that same command and does not repeat Clipboard or
  Linking.
- A successful external action disables editing, preview regeneration, copy,
  and browser handoff for that validated preview. Synchronous ref guards also
  coalesce rapid double presses before React state has rerendered.
- A status transport failure retains the exact preview, says the external action
  succeeded but local status did not, and exposes an action named either
  `Retry marking copied draft` or `Try updating local status`.
- A structured CAS conflict refetches the canonical report. The existing
  acknowledged-revision path accepts the component's own `EXPORTED` response;
  a later remote revision still produces the explicit export-draft conflict.
- Oversized handoff remains `copy -> blank composer open -> mark`. If copy
  succeeds but the blank composer fails, the copy still satisfies `EXPORTED`.
  If the oversize copy fails, the browser never opens and status never changes.
- Late Clipboard/Linking completion after unmount does not begin local status
  work. No success copy mentions publication.

## RED evidence

The initial focused export run failed 5 of 19 tests for the intended reasons:

1. standalone copy never called `updateFeedback`;
2. copy transport failure had no stable status-retry command;
3. copy CAS conflict never refreshed canonical state;
4. rapid copy presses called the native boundary twice; and
5. successful browser handoff left standalone copy enabled.

The first browser/API E2E run also failed before the API because its retained
parent review call had drifted behind the strict CAS contract and omitted
`expectedUpdatedAt`. The fetched private report revision is now passed.

The first native-acceptance execution reached both platforms' normal copy and
browser paths, then rejected the test's 8,025-character oversize fixture at the
6,000-character public-preview contract. The fixture was corrected to a valid
5,000-character Unicode body whose percent-encoded URL still exceeds the
handoff limit; no production limit was weakened.

## GREEN coverage

Focused export coverage has 21 tests for success, clipboard false/throw,
copy/browser ordering, stable retry, CAS conflict, own/later revision handling,
rapid copy/browser presses, unmount, normal browser failure, oversized fallback,
and copy-success/browser-failure semantics.

`feedback-native-acceptance.test.tsx` runs the same integrated component journey
for iOS and Android through the real `ParentFeedbackProvider`,
`SendFeedbackScreen`, `FeedbackInboxScreen`, `FeedbackDetailScreen`, and
`FeedbackExportScreen`. A single in-memory client harness enforces CAS and
idempotent replay. The journey verifies:

- distinct diagnostic source, Inbox platform label, and preview platform label;
- ordinary submission contains no GitHub/export terminology;
- review edits, diagnostic removal, and `READY` status use the real UI;
- maintainer tools default off in device-local storage, then locally enable the
  real detail-screen export control;
- exact server preview text is displayed;
- standalone `copy -> mark`, browser `open -> mark`, and oversized
  `copy -> open -> mark` ordering;
- no session token reaches external URLs or recorded public operations; and
- no component claims the draft was published.

The Playwright dashboard/API cross-client test now supplies the reviewed report
revision and again verifies private dashboard submission, parent-authorized
review, server sanitization, and draft generation without GitHub navigation or
publication.

## Node 24.19.0 verification

Verification used the ignored, checksum-verified worktree runtime at
`.local/node-runtimes/node-v24.19.0-darwin-arm64/bin/node`.

- Focused export + native acceptance: **2 suites, 23 tests passed**.
- Full parent: **17 suites, 146 tests passed**.
- Full shared/dashboard/API Vitest with real Colima PostgreSQL:
  **47 files, 513 tests passed**.
- Typecheck: all seven applicable workspace projects passed.
- Lint and Prettier check: passed.
- Production build: passed, including dashboard PWA.
- Playwright browser/API E2E: **2 tests passed**.
- GitHub credential scanner self-test: **7 scenarios passed**.
- E2E artifact security self-test: **14 scenarios passed**.
- GitHub credential scan, iOS/Android/dashboard production-bundle security scan,
  Drizzle migration check, and `git diff --check`: passed.

## Limitations

The new iOS/Android coverage is native component acceptance in Jest/React Native
Testing Library with injected Clipboard and Linking boundaries. It is not an
iOS simulator, Android emulator, or real-device E2E test and does not prove OS
permission dialogs, installed-browser behavior, or physical clipboard behavior.
The retained Playwright test is a real Chromium dashboard plus API/client
cross-client journey; it does not drive the parent app on a device. Neither test
contacts GitHub or can prove publication, by design.

The full Vitest run still prints existing React `act(...)` warnings in two
dashboard outbox cases and normal PostgreSQL migration/lock notices. All suites
exit successfully; this remediation did not broaden scope to unrelated warning
cleanup.
