# Family App Design

**Date:** August 8, 2026  
**Status:** Approved for implementation planning

## 1. Purpose

Build a private, local-first family organizer for parents and young children who do not yet have personal devices. Parents manage the household from native-style iPhone and Android apps. The children interact only with a wall-mounted Raspberry Pi touchscreen in the kitchen.

The first release centers on:

- Google Calendar visibility
- A shared pool of claimable chores
- Parent-gated chore approval
- Dollar-denominated reward balances and a complete ledger
- Savings goals and small moments of celebration

The product should be simple enough for young children, useful at a glance for the whole family, and self-hosted wherever practical.

## 2. Product Principles

1. **Local by default.** Family records, chore images, audit history, and application logic reside on the household's Ubuntu server.
2. **Parents remain in control.** Children cannot award money, change balances, or administer the household.
3. **Server-authoritative state.** Clients display state but do not decide deadlines, ownership, payouts, or permissions.
4. **Explain every dollar.** The displayed balance is the sum of an append-only transaction ledger, not an editable number without history.
5. **Designed for young children.** Use pictures, colors, large controls, short language, and minimal required reading.
6. **Encourage without ranking.** Celebrate individual and family progress without leaderboards or streak pressure.
7. **Graceful failure.** Internet outages should not blank the kitchen display or corrupt chore state.

## 3. Scope

### 3.1 Initial Release

- Equal-permission parent accounts with Google sign-in
- Household onboarding and dashboard pairing
- Google Calendar connection, selection, and child/family mapping
- Kitchen family overview and calendar agenda
- Parent-managed chore library with images, instructions, default value, and default time limit
- Shared pool of chore instances with per-instance overrides
- Child chore claim, countdown, completion submission, and expiration
- Parent approval inbox and push notifications
- Approval, rejection, extension, cancellation, and adjusted payout
- Dollar balances backed by a transaction ledger
- Parent-recorded purchases/withdrawals and manual corrections with required notes
- Savings goals with visual progress
- Celebration packs and parent thank-you notes
- Dashboard personalization, child colors, profile pictures, sounds, and reduced motion
- Outbound Home Assistant webhooks for chore lifecycle events, disabled by default
- Audit history, operational health checks, and backups

### 3.2 Deferred

- Recurring or individually assigned chores
- Child mobile accounts or devices
- Photo proof of completion
- Rewards catalog or points economy
- Voice control through Google or Home Assistant
- Meal planning
- Leaderboards and streaks
- Mystery bonuses and family-wide chore milestones

The architecture must leave room for deferred capabilities without including their workflows in the initial implementation.

## 4. User Roles and Permissions

### Parent

Both parents have equal household-administrator privileges. A parent can:

- Connect and map Google calendars
- Create children and edit profiles
- Create and edit chore templates
- Add, edit, extend, cancel, or remove pool chores
- Approve or reject chore submissions
- Adjust the payout during approval
- Record purchases, withdrawals, and corrections
- Create and update savings goals
- Pair or revoke a kitchen dashboard
- Configure notifications, celebrations, and Home Assistant webhooks
- Review household activity and audit history

### Child Profile

A child is a household profile, not an online identity. From a paired dashboard, the child can:

- View the shared family calendar and their own color-coded events
- View their balance and savings goal
- Browse available chores
- Claim one eligible chore under their profile
- View active chore instructions and time remaining
- Submit an active chore for approval
- Read child-appropriate parent feedback and celebrations

### Dashboard Device

The Raspberry Pi is paired by a parent with a short-lived setup code. It receives a revocable, restricted device credential. It may read dashboard-safe household data and perform explicitly permitted child actions. It may not manage calendars, balances, rewards, household settings, Google credentials, approvals, or audit records.

## 5. User Experiences

### 5.1 Kitchen Dashboard

The dashboard is a landscape, full-screen kiosk. Its home screen uses the approved family-overview layout:

- Date, time, and compact weather/status area
- Today's agenda as the dominant panel
- Events color-coded and labeled for Avery, Riley, or the family
- A card for each child showing profile image, balance, savings progress, and chore status
- A prominent Chore Board action
- A “what's next?” card for the next calendar event
- Clear local/offline and last-calendar-sync indicators when relevant

The visual system uses large touch targets, pictures alongside text, color-independent labels, readable contrast, short sentences, and restrained animation. Parent settings can mute sound and reduce motion.

### 5.2 Parent Mobile App

The native-style iPhone and Android app includes:

- **Home:** today's family schedule, active chores, pending approvals, and child balances
- **Approval inbox:** pending submissions with child, chore, elapsed time, proposed payout, and approval controls
- **Chore library:** templates and pictures, plus shared-pool management
- **Calendar settings:** Google connection, calendar selection, and family-member mapping
- **Rewards:** per-child balance, ledger, purchases, corrections, and savings goals
- **Activity:** chore and financial history with actor and timestamps
- **Settings:** household, children, paired dashboards, notifications, celebrations, webhooks, and account controls

Opening a chore push notification deep-links to the corresponding approval item. The inbox remains the source of truth if a notification is missed.

## 6. Core Workflows

### 6.1 Household Setup

1. The first parent signs in with Google and creates the household.
2. The parent creates Avery and Riley's profiles and selects their colors and images.
3. The parent grants calendar access and maps selected Google calendars to Avery, Riley, or family.
4. The parent invites the second parent, who signs in with Google and receives equal privileges.
5. The parent pairs the kitchen dashboard with a short-lived code displayed by the Pi.

### 6.2 Chore Library and Pool

A chore template contains:

- Name
- Child-friendly image
- Short instructions
- Default dollar value
- Default completion duration
- Active/archive status

Adding a template to the shared pool creates a distinct chore instance. Parents may override its value, instructions, or duration without changing the template. An instance has its own lifecycle and history.

### 6.3 Claim and Countdown

1. A child taps an available chore.
2. The dashboard shows the picture, instructions, proposed value, and time limit.
3. The child selects Avery or Riley and confirms “I'll do it.”
4. The server atomically changes the instance from `AVAILABLE` to `CLAIMED`, stores the child and deadline, and rejects competing claims.
5. The active chore and countdown remain accessible from the dashboard home screen.

The stored server deadline is authoritative. The client derives the visible countdown from that timestamp; it does not decide expiration.

### 6.4 Completion and Expiration

- Tapping “I'm done” asks the server to change a valid `CLAIMED` instance to `AWAITING_APPROVAL` and records the submission time.
- The instance leaves the shared pool and remains unavailable while awaiting approval.
- A scheduled server job returns an expired `CLAIMED` instance to `AVAILABLE`, clears the active claim, records the expiration, and tells the dashboard what happened.
- A parent may extend or cancel an active claim. Extension changes the server deadline and records the actor and reason.

### 6.5 Parent Decision

Submission creates an approval-inbox item and triggers a minimal push notification to enabled parent devices.

A parent may:

- **Approve:** optionally adjust the proposed payout and attach a thank-you note.
- **Reject and retry:** include an optional child-friendly reason and return the instance to `AVAILABLE`.
- **Reject and close:** remove the instance from the pool when it should not be retried.

Approval, final payout, approver, thank-you note, status transition, and reward credit occur in one database transaction. An idempotency key and database constraint prevent duplicate payment when a request is retried or two parents act concurrently. The second parent receives the already-resolved result.

### 6.6 Rewards Ledger

Each child has one dollar-denominated ledger. Transaction types include:

- Approved chore credit
- Purchase or withdrawal debit
- Parent correction credit
- Parent correction debit

Every transaction stores amount, child, household, actor, timestamp, category, required note for manual entries, and any related chore approval. Ledger entries are never edited or deleted through normal application flows. Corrections use compensating entries. The displayed balance is the sum of posted ledger entries.

### 6.7 Savings Goals and Celebrations

A child may have one active savings goal with a name, optional image, and target dollar amount. The dashboard shows current balance relative to the target; saving progress does not reserve or move funds.

After approval, the dashboard displays the selected celebration pack, final amount, and optional parent note. If the dashboard was offline, it shows the celebration once after reconnecting, provided the event has not already been acknowledged and is still recent. Sounds and motion respect household accessibility settings.

## 7. Calendar Integration

Google Calendar is authoritative for events. The application stores selected calendar identifiers, household mappings, encrypted OAuth refresh credentials, sync cursors, minimal normalized event data needed for the dashboard, and the last successful synchronization time.

Synchronization uses Google's incremental mechanism where available. A background worker refreshes event data and recovers with a bounded full resync if a cursor becomes invalid. Deleted and changed events propagate to the local cache. The dashboard labels stale data and continues showing the most recent successful cache during an outage.

The application does not create or edit Google Calendar events in the initial release.

## 8. Home Assistant Integration

Home Assistant is not a dependency of the core application. The initial integration is optional outbound HTTPS webhooks for:

- Chore claimed
- Chore submitted
- Chore expired
- Chore approved
- Chore rejected

Each subscription has a revocable secret. Deliveries are signed, have bounded retry with backoff, and appear in a parent-visible delivery log. Payloads use stable event names and identifiers and omit unnecessary child or financial information. A failed webhook never blocks a chore transition.

Voice commands, dashboard entity controls, and deeper Home Assistant APIs remain deferred.

## 9. Technical Architecture

### Clients

- **Parent app:** Expo/React Native for iOS and Android
- **Kitchen dashboard:** React web application optimized for Chromium kiosk mode on Raspberry Pi
- **Shared packages:** domain types, API contracts, validation, design tokens, and selected UI primitives where appropriate

The parent and dashboard interfaces remain separate applications because their navigation, permissions, layouts, and failure modes differ.

### Ubuntu Server

Docker Compose runs:

- Caddy as the single internal HTTP entry point
- Application API and background worker
- Self-hosted Supabase services for Google-backed authentication, realtime delivery, and private object storage
- PostgreSQL for application and audit data
- Backup and health-check jobs

Application-specific business operations go through explicit server endpoints or database functions rather than trusting broad client-side table access. Row-level security provides defense in depth for household isolation.

### Public Edge and Local Routing

The intended public hostname is `family.jordanwaters.net`, but it must remain unpublished until production authentication is implemented. Once approved, Cloudflare Tunnel can forward authenticated HTTPS and WebSocket traffic to Caddy without inbound router ports; Caddy routes only approved public paths.

PostgreSQL, Supabase administration, backup storage, server monitoring, and Home Assistant are not routed through the public hostname. Administrative access is LAN/VPN-only.

Local split-horizon DNS routes the Raspberry Pi to the LAN endpoint, allowing it to reach Caddy when the internet or Cloudflare is unavailable. Public and local TLS names and trust must be configured so the client does not bypass certificate verification.

### External Dependencies

- Google OAuth and Calendar APIs
- Apple Push Notification Service and Firebase Cloud Messaging, addressed directly by the self-hosted application worker using native device tokens
- Cloudflare Tunnel and DNS for remote ingress
- A weather provider only if the weather card is enabled

Push payloads contain a generic event type and opaque identifier. The authenticated app retrieves the actual approval details.

The initial release does not route notifications through Expo's hosted push relay. Native device tokens are stored encrypted on the Ubuntu server. This keeps notification orchestration local while still using the platform services required to reach iOS and Android devices.

## 10. Primary Data Model

The detailed schema belongs in the implementation plan, but the design requires these bounded concepts:

- `Household`
- `ParentMembership`
- `ChildProfile`
- `DashboardDevice`
- `CalendarConnection`
- `CalendarMapping`
- `CalendarEventCache`
- `ChoreTemplate`
- `ChoreInstance`
- `ChoreTransition`
- `ApprovalDecision`
- `LedgerTransaction`
- `SavingsGoal`
- `NotificationDevice`
- `CelebrationEvent`
- `WebhookSubscription`
- `WebhookDelivery`
- `AuditEvent`

Every household-owned record includes a household identifier. Monetary values use integer cents. Timestamps are stored in UTC and rendered in the household time zone.

## 11. Chore State Machine

Valid primary transitions are:

```text
AVAILABLE -> CLAIMED
CLAIMED -> AWAITING_APPROVAL
CLAIMED -> AVAILABLE            (expiration or parent cancellation)
AWAITING_APPROVAL -> APPROVED
AWAITING_APPROVAL -> AVAILABLE  (reject and retry)
AWAITING_APPROVAL -> CLOSED     (reject and close)
AVAILABLE -> CLOSED             (parent removes pool instance)
```

Invalid transitions return the current server state without changing the ledger. State-changing requests use optimistic concurrency or row locking, explicit authorization, and idempotency keys where retries are possible.

## 12. Offline and Error Behavior

### Kitchen Dashboard

- Cache the application shell, recent calendar agenda, child-safe profile data, current balances, and visible chore state.
- Continue rendering cached data and calculating a display-only countdown from the stored server deadline.
- Disable new claims, completion submissions, and other mutations until server confirmation is possible.
- Clearly label offline and stale-calendar states without blocking navigation.
- Reconnect automatically, reconcile with authoritative state, and avoid replaying stale taps.

### Parent App

- Show cached summaries when possible.
- Do not optimistically display a financial or approval mutation as final.
- Retry safe reads automatically; retry state changes only with their original idempotency key.
- Preserve pending form input after transient errors.

### Background Operations

- Calendar, push, and webhook failures are logged with bounded retry and do not roll back valid chore state.
- Expiration jobs are safe to run more than once.
- Monitoring distinguishes degraded external integrations from core database/API failure.

## 13. Security and Privacy

- Encrypt Google refresh credentials at rest with keys stored outside the database.
- Keep secrets in server-managed secret files or a secret manager, never in source control or client bundles.
- Use short-lived access tokens, secure refresh handling, and revocable dashboard device credentials.
- Enforce parent and dashboard permissions on the server for every request.
- Apply household isolation through authorization checks, database constraints, and row-level security.
- Rate-limit public authentication, pairing, and mutation endpoints.
- Restrict CORS and OAuth redirect URLs to known application origins.
- Serve chore images through authorization checks or short-lived signed URLs.
- Exclude access tokens, refresh tokens, webhook secrets, and unnecessary child data from structured logs.
- Record security-sensitive and financial operations in an append-only audit trail.
- Keep the Cloudflare-to-origin route restricted to the tunnel; do not expose the origin gateway directly.
- Document update cadence, dependency scanning, credential rotation, dashboard revocation, and incident recovery.

## 14. Operations and Recovery

- Run nightly encrypted backups of PostgreSQL and private image storage.
- Retain 30 daily and 12 monthly encrypted backups, including at least one automated copy outside the Ubuntu server.
- Monitor API, database, realtime, calendar synchronization, worker queues, disk capacity, certificate/tunnel status, and backup freshness.
- Perform periodic restoration drills into an isolated environment.
- Configure the Raspberry Pi to launch Chromium in kiosk mode after reboot, suppress sleep, and use a watchdog for browser crashes.
- Version Docker images and database migrations; upgrades must have rollback instructions.
- Provide a household data export and documented disaster-recovery procedure before production use.

## 15. Testing and Acceptance

### Automated Tests

- Unit tests for money arithmetic, ledger balance, deadline calculation, state transitions, savings progress, permissions, and notification policy
- Database tests proving cross-household access is denied
- Concurrency tests proving one claim winner and exactly one approval credit
- Integration tests for claim, submit, approve, reject, expiration, extension, cancellation, purchase, and correction flows
- Contract tests for mobile, dashboard, API, webhook, and realtime event payloads
- Calendar synchronization tests with recorded, anonymized fixtures
- Backup restoration test in an isolated database

### Device and Experience Tests

- Real iPhone and Android push, deep-link, authentication, and approval tests
- Raspberry Pi touchscreen target size, contrast, readability, clock drift, reconnect, reboot, and watchdog tests
- Child-usability check: Avery and Riley can identify a chore, claim it, find the active timer, and submit it without adult navigation help
- Reduced-motion, muted-sound, keyboard, screen-reader labeling, and color-independent status checks

### Release Acceptance Criteria

The initial release is acceptable when:

1. Both parents can sign in, administer one household, and receive approval notifications.
2. Selected Google calendars appear correctly on the dashboard with a visible last-sync state.
3. Only one child can claim a pool chore, expiration returns it safely, and completion creates one approval item.
4. Concurrent or retried approvals can create at most one ledger credit.
5. Every balance change is traceable to an immutable ledger entry and actor.
6. The dashboard recovers after reboot and continues showing cached, clearly labeled information during an internet outage.
7. After production authentication is implemented, remote mobile access can use `family.jordanwaters.net` without exposing the database or administration interfaces.
8. A full backup can be restored successfully.
9. Core child workflows meet the defined touchscreen usability check.

## 16. Implementation Sequence

The implementation plan should stage work in this order:

1. Repository and local development foundation
2. Self-hosted infrastructure and security baseline
3. Household identity, parent membership, and dashboard pairing
4. Chore library, pool, state machine, and ledger
5. Parent approval app and push delivery
6. Child dashboard and kiosk operation
7. Google Calendar synchronization and agenda UI
8. Savings goals, celebration packs, and thank-you notes
9. Home Assistant webhooks
10. Backup, monitoring, accessibility, security hardening, and release verification
