# Core Client Vertical Slice Design

**Date:** August 9, 2026  
**Status:** Approved for implementation planning
**Parent design:** `docs/superpowers/specs/2026-08-08-family-app-design.md`

## 1. Purpose

Build the first usable client milestone on top of the existing core chores and
ledger API. The milestone joins a native-style parent phone app and a
Raspberry Pi kitchen dashboard into one complete family workflow:

1. A parent creates a chore template and publishes a chore to the shared pool.
2. Avery or Riley claims the chore from the kitchen dashboard.
3. The child submits the chore for parent review.
4. A parent approves or rejects it from a phone.
5. An approved, optionally adjusted payout appears in the child's balance and
   immutable ledger.

This is a local-development vertical slice, not a production deployment. It
must prove the product interaction and client boundaries without weakening the
API's existing production-authentication refusal.

## 2. Scope

### 2.1 Included

- Expo/React Native parent application for iOS and Android
- React progressive web application for a landscape Chromium kiosk
- Shared typed API client, client-side read models, design tokens, and chore
  picture catalogue
- Parent home, approval inbox, chore library/pool, and rewards experiences
- Dashboard family home, chore board, claim, countdown, submission, and waiting
  experiences
- Role-specific parent and dashboard API snapshots
- Built-in chore pictures selected by stable keys
- A repeatable development seed workflow for one household, Avery, Riley,
  starter chores, a parent actor, and a dashboard actor
- Development credential setup that never commits tokens
- Persisted safe-read caches and explicit offline/stale states
- Polling-based synchronization with a replaceable query boundary
- Automated contract, API, component, accessibility, and dashboard browser tests

### 2.2 Excluded

- Production Google sign-in, sessions, invitations, or dashboard pairing
- Push notifications and notification deep links
- Google Calendar synchronization or calendar UI
- Public ingress, Cloudflare Tunnel, Caddy, Supabase, or Ubuntu deployment
- Realtime subscriptions
- Savings goals and celebration delivery
- Home Assistant webhooks or voice control
- Arbitrary image upload, private object storage, or camera/photo proof
- Child mobile accounts

Excluded features receive no placeholder screens. Their later implementation
must fit the boundaries established here.

## 3. Architecture

### 3.1 Separate clients

The parent and dashboard interfaces are separate applications:

- `apps/parent` is an Expo/React Native application. It uses native navigation,
  secure credential storage, and phone-appropriate forms and controls.
- `apps/dashboard` is a React progressive web application built for Chromium in
  landscape kiosk mode. It uses large touch targets, persistent safe-read data,
  and service-worker-backed application-shell caching.

The applications do not share screen components. Their layouts, permissions,
navigation, offline behavior, and deployment targets are intentionally
different.

### 3.2 Shared packages

- `packages/api-client` owns authenticated requests, UUID idempotency keys,
  Zod response parsing, query-key construction, asset URL resolution, and
  normalized client errors. It contains no React or platform storage code.
- `packages/design-tokens` owns colors, type scales, spacing, radii, motion
  preferences, minimum target sizes, and color-independent status metadata.
- `packages/contracts` owns the finite `ChoreImageKey` enum used on the wire.
  `packages/chore-images` maps those contracted keys to accessible labels and
  bundled raster assets. Each client supplies a small platform-specific renderer
  for the shared keys.
- `packages/contracts` remains the API source of truth. Client-only view helpers
  may depend on contracts; contracts never depend on a client package.

The database and contracts gain a nullable `imageKey` for templates and chore
instances. The existing nullable `imageUrl` remains reserved for later custom
uploads. During this milestone, parent-created templates require a built-in
`imageKey`, and clients render `imageKey` before considering `imageUrl`.

### 3.3 Server boundaries

Existing mutation endpoints remain server-authoritative. The clients do not
reimplement permissions, state transitions, deadline decisions, or ledger
arithmetic.

The API adds two role-specific read endpoints:

- `GET /v1/parent/snapshot` requires a parent actor and returns household
  identity, child profiles and balances, active chores, pending submission
  attempts, chore templates, shared-pool instances, and the server timestamp.
- `GET /v1/dashboard/snapshot` requires a dashboard actor and returns only
  child-safe profiles, aggregate balances, available/active/waiting chores,
  built-in picture keys, connection-relevant timestamps, and the server
  timestamp.

Detailed ledger history remains behind the existing parent-only ledger route.
The dashboard snapshot never includes transaction rows, notes, parent actor
identifiers, approval metadata, or administrative settings.

The snapshot endpoints are coherent database reads. Each endpoint uses one
repeatable-read transaction so child balances, chore state, and inbox state do
not describe different moments.

## 4. Development Fixture Workflow

A repository command creates or refreshes one named development household with:

- Avery and Riley's child profiles and distinct colors
- One equal-permission parent membership
- One restricted dashboard device record
- A small chore-template library with built-in pictures
- Several available chores and at least one ledger example per child

The command is idempotent for its named development fixture. It creates signed
parent and dashboard fixture tokens using the explicitly configured
`DEVELOPMENT_AUTH_SECRET`. Credentials are written only to an ignored local
configuration directory with owner-only permissions. The command prints paths
and non-secret actor identifiers, not raw tokens, to normal logs.

The parent app has a development-only setup screen for API origin and parent
token import. It moves the token into secure device storage and never renders it
again. The dashboard has a development-only setup screen for API origin and
dashboard token import. Chromium persists that restricted token so kiosk
restarts recover automatically. Changing the origin or credential clears the
old actor's cached data before the new session starts.

These screens and fixture authenticators are unavailable in production builds.
The API continues refusing production startup unless a non-development
`ActorAuthenticator` is supplied.

## 5. Parent Application

### 5.1 Navigation

The parent app uses four primary destinations:

- **Home** — child balances, active chore summaries, and pending-approval count
- **Approvals** — unresolved submissions and decision controls
- **Chores** — template library, creation form, and shared-pool publishing
- **Rewards** — per-child balance, ledger history, purchases, and corrections

Settings beyond development connection management are excluded from this
milestone.

### 5.2 Home

Home shows Avery and Riley as distinct, color-independent cards. Each card
contains the child's name, picture or initials, formatted dollar balance, and
current chore state. A pending-approval card links to the inbox. Pull-to-refresh
requests a new parent snapshot without discarding the last valid view.

### 5.3 Approvals

The inbox is ordered oldest submission first. Each item shows child, chore
picture and name, submitted time, elapsed completion time when derivable, and
proposed payout.

The decision screen supports:

- Approve with the proposed payout
- Approve with an adjusted nonnegative payout within the server ceiling
- An optional parent thank-you note
- Reject and return the chore to the pool
- Reject and close the chore
- An optional child-friendly rejection reason

The interface sends the immutable `submissionAttemptId` and one retained
idempotency key. It displays no resolved outcome until the server responds. If
the other parent already decided, the server's immutable winning decision is
shown and the inbox refreshes.

### 5.4 Chores

Parents can create a template with name, built-in picture, short instructions,
default dollar value, and default duration. The form uses decimal dollars for
input and converts to integer cents only through a tested money parser.

Publishing creates a distinct shared-pool instance. The parent may accept the
template defaults or override value, instructions, and duration for that
instance. Template editing, archiving, instance removal, and arbitrary image
upload are excluded from this vertical slice.

### 5.5 Rewards

Rewards shows a child selector, aggregate balance, and reverse-chronological
parent-only ledger. Chore credits, purchases, manual credits, and corrections
have distinct text labels and color-independent icons.

Parents can record:

- A purchase as a positive dollar input converted to a negative `PURCHASE`
  ledger amount
- A manual credit as a positive `MANUAL_CREDIT` amount
- A correction as an explicitly signed nonzero `CORRECTION` amount

Every manual entry requires a note. Forms retain their input after transient
errors and clear only after a confirmed server response.

## 6. Kitchen Dashboard

### 6.1 Visual and interaction rules

The dashboard targets a landscape Raspberry Pi touchscreen in Chromium kiosk
mode. Interactive targets are at least 64 CSS pixels on their shortest side.
Text and status never rely on color alone. Body copy uses short sentences, and
important actions pair a picture with a verb.

The dashboard respects reduced-motion preferences. This milestone uses no
sound. Keyboard focus remains visible so the PWA can also be tested without a
touchscreen.

### 6.2 Family home

The family home shows:

- Local date and time
- Online, offline, or reconnecting state
- Avery and Riley cards with name, color-independent identity, aggregate
  balance, and current chore state
- A dominant **Chore Board** action
- A compact shared-pool availability count

No calendar placeholder is shown. Calendar space is added only when real Google
Calendar data exists.

### 6.3 Chore board and claim

Available chores appear as large picture tiles with name, formatted value, and
time limit. The claim sequence is:

1. Select a chore.
2. Review its picture, short instructions, value, and time limit.
3. Select Avery or Riley.
4. Confirm **I'll do it**.

The client retains one idempotency key while a claim is pending or retried. A
claim conflict returns to the refreshed board with the child-friendly message
“That chore was just claimed.”

### 6.4 Active chore and submission

An active chore view shows picture, instructions, claimed child, and a visible
countdown. The API's stored deadline is authoritative. The dashboard computes a
display-only countdown using the server timestamp to estimate clock offset; it
never changes chore state locally when the display reaches zero.

The **I'm done** action requires a confirmation tap and then submits the active
chore with one retained idempotency key. On success, the child sees “Waiting for
a grown-up.” The dashboard refreshes until the server reports the authoritative
next state.

This milestone does not add a celebration queue. Approved chores disappear from
the waiting state and the confirmed balance appears on the next snapshot.

## 7. Client Data Flow

TanStack Query provides the replaceable server-state boundary in both clients.
Platform adapters persist only successful safe reads:

- Parent: encrypted credential storage plus AsyncStorage-backed query data
- Dashboard: restricted credential storage plus IndexedDB-backed query data

Cache keys include API origin, household identifier, actor identifier, role,
resource, and resource parameters. Credential or origin changes clear all old
query data before new requests begin.

Reads retry bounded transient failures. Mutations do not create optimistic final
state. Each mutation operation owns a UUID idempotency key that survives retries
of that operation and is discarded only after a confirmed result or explicit
form cancellation.

After a successful mutation, the client invalidates the affected snapshot and
resource query. While a claimed or waiting chore exists, the dashboard polls
every five seconds; otherwise it polls every thirty seconds. While the approval
inbox is nonempty, the foregrounded parent app polls every fifteen seconds;
otherwise it refreshes on focus and explicit pull-to-refresh. Polling pauses
when an app is backgrounded or the browser is hidden. The query boundary must
allow a later realtime event source to trigger the same invalidations without
changing screens.

## 8. Offline and Error Behavior

Both clients retain and label the last valid safe-read view. An offline or stale
label includes the last successful refresh time. Safe reads retry when
connectivity returns.

The dashboard disables claim and submit actions without connectivity. It does
not queue child mutations for later replay. The parent app also does not queue
financial or approval mutations; it preserves form state so a parent can retry
deliberately with the same idempotency key.

The shared API client maps structured server errors to stable client error
kinds. Screens translate those kinds into brief, actionable language. Unknown,
malformed, or unvalidated responses use a generic failure state and do not
mutate cached authoritative data.

At minimum, the clients distinguish:

- Authentication required or expired
- Actor forbidden from the operation
- Resource not found
- Chore conflict or already-resolved decision
- Validation failure with field errors
- Offline/network unavailable
- Service unavailable
- Unexpected or malformed response

## 9. Security and Privacy

- Fixture tokens never enter tracked files, screenshots, structured logs, error
  reports, or normal command output.
- Development setup code is excluded from production bundles through explicit
  build-time configuration and verified production-bundle tests.
- The parent token is stored with the platform secure-storage facility.
- The dashboard token is restricted by server role and stored only because the
  kiosk must recover after reboot; it remains revocable in the data model.
- Dashboard responses omit parent-only and transaction-level information at the
  server, not merely in the UI.
- All responses are parsed against shared schemas before entering a cache.
- Every mutation retains existing household authorization and idempotency
  enforcement.
- Generic chore-picture assets contain no household or child information and
  may be bundled publicly with the applications.

This milestone is not safe for public ingress. Production authentication,
rate-limiting, CORS, TLS, RLS, dashboard pairing, and deployment hardening remain
release blockers.

## 10. Testing

### 10.1 Shared packages

- Contract tests for parent and dashboard snapshots, picture keys, and image
  fallback behavior
- API-client tests for authorization headers, response validation, normalized
  errors, cache partition keys, asset URLs, and idempotency-key reuse
- Money parser/formatter tests for cents, zero, negative corrections, rounding
  rejection, and PostgreSQL integer limits
- Design-token tests for minimum touch target and color-independent status labels

### 10.2 API

- PostgreSQL integration tests for coherent parent and dashboard snapshots
- Permission tests proving parent-only and dashboard-only access
- Negative assertions proving dashboard payloads contain no ledger transactions,
  notes, parent identifiers, decision metadata, or settings
- Development seed tests proving reruns do not duplicate the named fixture and
  credentials are written only to ignored, owner-only files (`0600` on Unix)
- Migration replay tests for the new chore image key

### 10.3 Parent app

- Component tests for home summaries, oldest-first inbox order, approval with an
  adjusted payout, both rejection modes, template creation, pool publishing,
  purchase, manual credit, and correction
- Failure tests proving forms persist until a confirmed response and concurrent
  decisions render the server's winning result
- Accessibility assertions for labels, roles, focus order, and non-color status
  indicators
- Bundle checks for iOS and Android development builds and proof that production
  bundles omit development credential setup

### 10.4 Dashboard

- Component tests for chore tiles, child selection, claim confirmation, claim
  conflict, server-offset countdown, submission confirmation, waiting state,
  offline mutation disabling, stale labels, and cache clearing on actor change
- Automated assertions that every primary touch target meets the 64-pixel rule
- PWA tests for installable manifest, application-shell caching, cached safe-read
  rendering, and reconnect invalidation
- Playwright browser coverage for the seeded claim-to-submit path against the
  real local API

## 11. Acceptance Criteria

The milestone is complete when all of the following are true:

1. One repeatable seed command creates or refreshes the development household,
   Avery, Riley, starter templates, shared-pool chores, and separate restricted
   parent/dashboard credentials without logging raw tokens.
2. The parent app bundles for iOS and Android and can connect to the local API
   through its development setup flow.
3. The dashboard builds as an installable PWA and runs in a landscape Chromium
   browser suitable for Raspberry Pi kiosk mode.
4. A parent can create a pictured template and publish a chore to the shared
   pool.
5. Avery or Riley can claim that chore, see the server-derived countdown, and
   submit it from the dashboard.
6. A parent sees the submission in the approval inbox and can approve it with an
   adjusted payout or use either rejection mode.
7. Approval produces exactly one linked immutable ledger credit, and the updated
   balance appears in both clients.
8. A parent can record a purchase, manual credit, and correction with required
   notes, and each appears as a separate immutable ledger transaction.
9. Refreshes, duplicate taps, transient retries, and two-parent decision races do
   not duplicate chores, decisions, or payments.
10. During a temporary outage, both clients retain labeled cached safe reads,
    preserve parent form input, and prevent unconfirmed dashboard mutations.
11. Automated tests and repository-wide typecheck, build, lint, formatting,
    migration, and production-bundle safety checks pass.

## 12. Implementation Boundary

This phase should be implemented as one vertical-slice plan with independently
reviewable tasks for shared client foundations, server read models and seed
workflow, parent app workflows, dashboard workflows, offline/PWA behavior, and
full-stack verification. Work must follow test-driven development and preserve
the existing PostgreSQL 17 integration coverage.

The next phase after this milestone is production household identity and secure
dashboard pairing or Google Calendar synchronization, selected through a new
design cycle.
